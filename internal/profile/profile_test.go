package profile

import "testing"

func TestAllowAnonymous(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want bool
	}{
		{"empty is private", "", false},
		{"whitespace only is private", "   ", false},
		{"configured url is public", "https://memos.example.com", true},
		{"configured url with padding is public", "  https://memos.example.com  ", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := &Profile{InstanceURL: c.url}
			if got := p.AllowAnonymous(); got != c.want {
				t.Fatalf("AllowAnonymous() with InstanceURL=%q = %v, want %v", c.url, got, c.want)
			}
		})
	}
}

func TestValidateDatabaseConnectionLimits(t *testing.T) {
	tests := []struct {
		name    string
		profile *Profile
	}{
		{
			name:    "negative max open connections",
			profile: &Profile{DBMaxOpenConns: -1},
		},
		{
			name:    "negative max idle connections",
			profile: &Profile{DBMaxIdleConns: -1},
		},
		{
			name:    "idle connections exceed open connections",
			profile: &Profile{DBMaxOpenConns: 2, DBMaxIdleConns: 3},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.profile.Validate(); err == nil {
				t.Fatal("Validate() error = nil, want connection limit validation error")
			}
		})
	}
}
