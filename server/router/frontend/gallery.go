package frontend

import (
	"bytes"
	"context"
	"html/template"
	"io/fs"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/server/gallery"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
)

// RegisterGalleryRoutes adds HTTP projections of the existing API services.
// These native Echo handlers do not pass through the RPC ACL map: readContext
// authenticates them and the invoked MemoService methods enforce resource access.
func (s *FrontendService) RegisterGalleryRoutes(e *echo.Echo, api *apiv1.APIV1Service) {
	handler := &galleryHandler{
		service:       &gallery.Service{API: api},
		authenticator: auth.NewAuthenticator(s.Store, api.Secret),
		frontend:      s,
	}
	e.GET("/api/v1/gallery/photos", handler.listJSON)
	e.GET("/api/v1/gallery/photos/:uid", handler.getJSON)
	e.GET("/gallery", handler.listHTML)
	e.GET("/gallery/photos/:uid", handler.getHTML)
}

type galleryHandler struct {
	service       *gallery.Service
	authenticator *auth.Authenticator
	frontend      *FrontendService
}

func galleryHeaders(c *echo.Context) {
	h := c.Response().Header()
	h.Set(echo.HeaderCacheControl, "private, no-store")
	h.Set("Vary", "Cookie, Authorization")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Robots-Tag", "noindex, nofollow, noarchive")
}

func (h *galleryHandler) readContext(c *echo.Context, shareToken string) (context.Context, error) {
	galleryHeaders(c)
	ctx := c.Request().Context()
	if shareToken != "" {
		// Share resolution is checked by GetSharedMemo; it intentionally remains
		// available on private instances and does not grant a signed-in identity.
		return ctx, nil
	}
	viewer, err := h.authenticator.AuthenticateToUser(ctx, c.Request().Header.Get("Authorization"), c.Request().Header.Get("Cookie"))
	if err != nil && auth.IsAuthenticationStoreError(err) {
		return ctx, echo.NewHTTPError(http.StatusServiceUnavailable, "authentication is unavailable").Wrap(err)
	}
	if viewer != nil {
		return auth.SetUserInContext(ctx, viewer, ""), nil
	}
	if !h.frontend.Profile.AllowAnonymous() {
		return ctx, echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}
	return ctx, nil
}

func galleryQuery(c *echo.Context) gallery.Query {
	return gallery.Query{
		Visibility: c.QueryParam("visibility"), Tag: c.QueryParam("tag"),
		State: c.QueryParam("state"), PageToken: c.QueryParam("pageToken"),
	}
}

func (h *galleryHandler) listJSON(c *echo.Context) error {
	ctx, err := h.readContext(c, "")
	if err != nil {
		return err
	}
	page, err := h.service.List(ctx, galleryQuery(c))
	if err != nil {
		return galleryHTTPError(err)
	}
	return c.JSON(http.StatusOK, page)
}

func (h *galleryHandler) getJSON(c *echo.Context) error {
	shareToken := c.QueryParam("share_token")
	ctx, err := h.readContext(c, shareToken)
	if err != nil {
		return err
	}
	photo, err := h.service.Get(ctx, c.Param("uid"), shareToken)
	if err != nil {
		return galleryHTTPError(err)
	}
	return c.JSON(http.StatusOK, photo)
}

func (h *galleryHandler) listHTML(c *echo.Context) error {
	ctx, err := h.readContext(c, "")
	if err != nil {
		return err
	}
	page, err := h.service.List(ctx, galleryQuery(c))
	if err != nil {
		return galleryHTTPError(err)
	}
	view := galleryPageView{
		Title: "Photo gallery", URL: h.absoluteURL(c, "/gallery"),
		NoIndex: auth.GetUserID(ctx) != 0 || !h.frontend.Profile.AllowAnonymous(),
	}
	for i := range page.Photos {
		view.Photos = append(view.Photos, photoView(&page.Photos[i], ""))
	}
	if page.NextPageToken != "" {
		query := c.Request().URL.Query()
		query.Set("pageToken", page.NextPageToken)
		view.NextURL = "/gallery?" + query.Encode()
	}
	return h.renderHTML(c, view)
}

func (h *galleryHandler) getHTML(c *echo.Context) error {
	shareToken := c.QueryParam("share_token")
	ctx, err := h.readContext(c, shareToken)
	if err != nil {
		return err
	}
	photo, err := h.service.Get(ctx, c.Param("uid"), shareToken)
	if err != nil {
		return galleryHTTPError(err)
	}
	item := photoView(photo, shareToken)
	view := galleryPageView{
		Title: item.Title, Description: photo.Memo.Snippet, Photos: []galleryPhotoView{item},
		URL: h.absoluteURL(c, item.URL), ImageURL: h.absoluteURL(c, item.ThumbnailURL),
		NoIndex: shareToken != "" || photo.Memo.Visibility != v1pb.Visibility_PUBLIC || photo.Memo.State != v1pb.State_NORMAL || !h.frontend.Profile.AllowAnonymous(),
	}
	return h.renderHTML(c, view)
}

func (h *galleryHandler) absoluteURL(c *echo.Context, path string) string {
	if h.frontend.Profile.InstanceURL != "" {
		return strings.TrimRight(h.frontend.Profile.InstanceURL, "/") + path
	}
	// An InstanceURL also enables anonymous access; do not change it merely to
	// render a private share. Use the request origin, never x-forwarded-host.
	scheme := "http"
	if c.Request().TLS != nil || c.Request().Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return (&url.URL{Scheme: scheme, Host: c.Request().Host}).String() + path
}

type galleryPageView struct {
	Title, Description, URL, ImageURL, NextURL string
	NoIndex                                    bool
	Photos                                     []galleryPhotoView
}

type galleryPhotoView struct {
	Title, URL, ImageURL, ThumbnailURL, MemoURL, Description string
	Tags                                                     []string
	Metadata                                                 []galleryMetadata
}

type galleryMetadata struct {
	Name, Value string
}

func photoView(photo *gallery.Photo, shareToken string) galleryPhotoView {
	attachment := photo.Attachment
	uid := strings.TrimPrefix(attachment.Name, "attachments/")
	fileURL := "/file/" + attachment.Name + "/" + url.PathEscape(attachment.Filename)
	query := url.Values{}
	photoURL := "/gallery/photos/" + url.PathEscape(uid)
	memoURL := "/" + photo.Memo.Name
	if shareToken != "" {
		query.Set("share_token", shareToken)
		photoURL += "?" + query.Encode()
		memoURL = "/memos/shares/" + url.PathEscape(shareToken)
	}
	imageURL := fileURL
	if len(query) > 0 {
		imageURL += "?" + query.Encode()
	}
	query.Set("thumbnail", "true")
	view := galleryPhotoView{
		Title: attachment.Filename, URL: photoURL, ImageURL: imageURL,
		ThumbnailURL: fileURL + "?" + query.Encode(), MemoURL: memoURL,
		Description: photo.Memo.Snippet, Tags: photo.Memo.Tags,
	}
	if metadata := attachment.GetMediaMetadata().GetPhoto(); metadata != nil {
		for _, field := range []galleryMetadata{
			{"Camera", strings.TrimSpace(metadata.CameraMake + " " + metadata.CameraModel)},
			{"Lens", metadata.LensModel},
			{"Captured", metadata.GetCaptureTime().GetLocalDateTime()},
			{"Color space", metadata.ColorSpace},
			{"ICC profile", metadata.IccProfile},
			{"White balance", metadata.WhiteBalance},
			{"Metering", metadata.MeteringMode},
			{"Exposure program", metadata.ExposureProgram},
		} {
			if field.Value != "" {
				view.Metadata = append(view.Metadata, field)
			}
		}
		for _, field := range []struct {
			name, prefix, suffix string
			value                *float64
		}{
			{"Aperture", "f/", "", metadata.FNumber},
			{"Exposure", "", " s", metadata.ExposureTimeSeconds},
			{"Focal length", "", " mm", metadata.FocalLengthMm},
			{"35mm focal length", "", " mm", metadata.FocalLength_35Mm},
			{"Exposure bias", "", " EV", metadata.ExposureBiasEv},
		} {
			if field.value != nil {
				view.Metadata = append(view.Metadata, galleryMetadata{
					field.name, field.prefix + strconv.FormatFloat(*field.value, 'f', -1, 64) + field.suffix,
				})
			}
		}
		if metadata.Iso != nil {
			view.Metadata = append(view.Metadata, galleryMetadata{"ISO", strconv.Itoa(int(*metadata.Iso))})
		}
		if metadata.BitsPerSample != nil {
			view.Metadata = append(view.Metadata, galleryMetadata{"Bit depth", strconv.Itoa(int(*metadata.BitsPerSample))})
		}
		if location := metadata.Location; location != nil && location.Latitude != nil && location.Longitude != nil {
			view.Metadata = append(view.Metadata, galleryMetadata{
				"Coordinates", strconv.FormatFloat(*location.Latitude, 'f', -1, 64) + ", " + strconv.FormatFloat(*location.Longitude, 'f', -1, 64),
			})
		}
	}
	return view
}

var galleryHeadTemplate = template.Must(template.New("gallery-head").Parse(`
<title>{{.Title}} · Memos</title>
<meta name="description" content="{{.Description}}">
<meta property="og:type" content="website">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
{{if .ImageURL}}<meta property="og:image" content="{{.ImageURL}}"><meta name="twitter:card" content="summary_large_image">{{end}}
{{if .NoIndex}}<meta name="robots" content="noindex, nofollow, noarchive">{{end}}
`))

var galleryBodyTemplate = template.Must(template.New("gallery-body").Parse(`
<main aria-label="Photo gallery" style="max-width:1200px;margin:auto;padding:24px">
<h1>{{.Title}}</h1>
{{range .Photos}}<article>
<a href="{{.URL}}"><img src="{{.ThumbnailURL}}" alt="{{.Title}}" style="max-width:100%;height:auto" loading="lazy"></a>
<h2><a href="{{.URL}}">{{.Title}}</a></h2>
<p>{{.Description}}</p>
{{range .Tags}}<span>#{{.}} </span>{{end}}
<dl>{{range .Metadata}}<dt>{{.Name}}</dt><dd>{{.Value}}</dd>{{end}}</dl>
<a href="{{.ImageURL}}">Original image</a> · <a href="{{.MemoURL}}">Open memo</a>
</article>{{else}}<p>No photos on this page.</p>{{end}}
{{if .NextURL}}<a href="{{.NextURL}}">Next page</a>{{end}}
</main>`))

var (
	galleryTitlePattern = regexp.MustCompile(`(?s)<title>.*?</title>`)
	galleryRootPattern  = regexp.MustCompile(`<div\s+id="root"[^>]*>\s*</div>`)
)

func (*galleryHandler) renderHTML(c *echo.Context, view galleryPageView) error {
	page, err := fs.ReadFile(getFileSystem("dist"), "index.html")
	if err != nil {
		return errors.Wrap(err, "read frontend template")
	}
	var head, body bytes.Buffer
	if err := galleryHeadTemplate.Execute(&head, view); err != nil {
		return errors.Wrap(err, "render photo metadata")
	}
	if err := galleryBodyTemplate.Execute(&body, view); err != nil {
		return errors.Wrap(err, "render photo content")
	}
	html := galleryTitlePattern.ReplaceAllString(string(page), "")
	html = strings.Replace(html, "</head>", head.String()+"</head>", 1)
	if galleryRootPattern.MatchString(html) {
		html = galleryRootPattern.ReplaceAllStringFunc(html, func(string) string {
			return `<div id="root">` + body.String() + `</div>`
		})
	} else {
		html = strings.Replace(html, "</body>", `<div id="root">`+body.String()+`</div></body>`, 1)
	}
	if view.NoIndex {
		c.Response().Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	} else {
		c.Response().Header().Del("X-Robots-Tag")
	}
	return c.HTML(http.StatusOK, html)
}

func galleryHTTPError(err error) error {
	var code int
	switch status.Code(err) {
	case codes.InvalidArgument:
		code = http.StatusBadRequest
	case codes.NotFound:
		code = http.StatusNotFound
	case codes.Unauthenticated:
		code = http.StatusUnauthorized
	case codes.PermissionDenied:
		code = http.StatusForbidden
	case codes.Unavailable:
		code = http.StatusServiceUnavailable
	default:
		code = http.StatusInternalServerError
	}
	message := "gallery data is unavailable"
	if code < 500 {
		message = status.Convert(err).Message()
	}
	return echo.NewHTTPError(code, message).Wrap(err)
}
