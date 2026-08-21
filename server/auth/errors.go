package auth

import "github.com/pkg/errors"

type authenticationStoreError struct {
	operation string
	cause     error
}

func (e *authenticationStoreError) Error() string {
	return e.operation + ": " + e.cause.Error()
}

func (e *authenticationStoreError) Unwrap() error {
	return e.cause
}

func newAuthenticationStoreError(operation string, cause error) error {
	return &authenticationStoreError{operation: operation, cause: cause}
}

// IsAuthenticationStoreError reports whether authentication failed because its
// backing store was unavailable, rather than because credentials were invalid.
func IsAuthenticationStoreError(err error) bool {
	var target *authenticationStoreError
	return errors.As(err, &target)
}
