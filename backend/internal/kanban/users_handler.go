package kanban

import (
	"errors"
	"net/http"
	"strings"
)

func (h handler) listUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := CurrentUser(r.Context()); !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	users, err := h.repo.ListUsers(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]UserPublic, 0, len(users))
	for _, u := range users {
		out = append(out, u.Public())
	}
	reply(w, 200, out)
}

func (h handler) createUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	if actor.Role != RoleAdmin {
		reply(w, 403, map[string]string{"message": msgForbidden})
		return
	}
	var in struct {
		LoginName   string  `json:"loginName"`
		Password    string  `json:"password"`
		DisplayName string  `json:"displayName"`
		Role        *string `json:"role"`
	}
	if !decode(w, r, &in) {
		return
	}
	role := ""
	if in.Role != nil {
		role = *in.Role
	}
	created, err := h.repo.CreateUser(r.Context(), UserCreateInput{
		LoginName:   in.LoginName,
		Password:    in.Password,
		DisplayName: in.DisplayName,
		Role:        role,
	})
	if err != nil {
		failUserWrite(w, err)
		return
	}
	reply(w, 201, created.Public())
}

func (h handler) patchUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	if actor.Role != RoleAdmin {
		reply(w, 403, map[string]string{"message": msgForbidden})
		return
	}
	id, ok := id(w, r)
	if !ok {
		return
	}
	var in struct {
		DisplayName *string `json:"displayName"`
		Role        *string `json:"role"`
		Disabled    *bool   `json:"disabled"`
		Password    *string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.DisplayName == nil && in.Role == nil && in.Disabled == nil && in.Password == nil {
		invalid(w, msgUserInvalid)
		return
	}
	if in.DisplayName != nil {
		trimmed := strings.TrimSpace(*in.DisplayName)
		in.DisplayName = &trimmed
	}
	updated, err := h.repo.UpdateUser(r.Context(), id, UserPatch{
		DisplayName: in.DisplayName,
		Role:        in.Role,
		Disabled:    in.Disabled,
		Password:    in.Password,
	}, actor.ID)
	if err != nil {
		failUserWrite(w, err)
		return
	}
	reply(w, 200, updated.Public())
}

func failUserWrite(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidUserInput):
		reply(w, 400, map[string]string{"message": msgUserInvalid})
	case errors.Is(err, ErrLoginNameTaken):
		reply(w, 409, map[string]string{"message": msgLoginTaken})
	case errors.Is(err, ErrLastAdmin):
		reply(w, 400, map[string]string{"message": msgLastAdmin})
	case errors.Is(err, ErrSelfDisable):
		reply(w, 400, map[string]string{"message": msgSelfDisable})
	case errors.Is(err, ErrNotFound):
		reply(w, 404, map[string]string{"message": "ユーザーが見つかりません。"})
	default:
		fail(w, err)
	}
}
