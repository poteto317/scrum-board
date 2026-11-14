package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

func (h handler) listCommandTemplates(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.ListCommandTemplates(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]CommandTemplate{"templates": list})
}

func (h handler) createCommandTemplate(w http.ResponseWriter, r *http.Request) {
	var in CommandTemplateInput
	if !decode(w, r, &in) {
		return
	}
	name, ok := NormalizeCommandTemplateName(in.Name)
	if !ok {
		invalid(w, "名前は1〜60文字で、制御文字を含めず入力してください。")
		return
	}
	body, ok := NormalizeCommandTemplateBody(in.Template)
	if !ok {
		invalid(w, "テンプレートは1〜2000文字で、制御文字を含めず入力してください。")
		return
	}
	in.Name, in.Template = name, body
	created, err := h.repo.CreateCommandTemplate(r.Context(), in)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 201, created)
}

func (h handler) updateCommandTemplate(w http.ResponseWriter, r *http.Request) {
	n, ok := commandTemplateID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name     json.RawMessage `json:"name"`
		Template json.RawMessage `json:"template"`
	}
	if !decode(w, r, &body) {
		return
	}
	var patch CommandTemplatePatch
	if len(body.Name) > 0 {
		name, valid := normalizeCommandTemplateField(body.Name, NormalizeCommandTemplateName)
		if !valid {
			invalid(w, "名前は1〜60文字で、制御文字を含めず入力してください。")
			return
		}
		patch.Name = &name
	}
	if len(body.Template) > 0 {
		template, valid := normalizeCommandTemplateField(body.Template, NormalizeCommandTemplateBody)
		if !valid {
			invalid(w, "テンプレートは1〜2000文字で、制御文字を含めず入力してください。")
			return
		}
		patch.Template = &template
	}
	if patch.Name == nil && patch.Template == nil {
		invalid(w, "name か template を指定してください。")
		return
	}
	updated, err := h.repo.UpdateCommandTemplate(r.Context(), n, patch)
	if err != nil {
		failCommandTemplate(w, err)
		return
	}
	reply(w, 200, updated)
}

func (h handler) deleteCommandTemplate(w http.ResponseWriter, r *http.Request) {
	n, ok := commandTemplateID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteCommandTemplate(r.Context(), n); err != nil {
		failCommandTemplate(w, err)
		return
	}
	w.WriteHeader(204)
}

func normalizeCommandTemplateField(raw json.RawMessage, normalize func(string) (string, bool)) (string, bool) {
	if string(raw) == "null" {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return normalize(value)
}

func failCommandTemplate(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, 404, map[string]string{"message": "テンプレートが見つかりません。"})
		return
	}
	fail(w, err)
}

func commandTemplateID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "テンプレートIDが不正です。")
		return 0, false
	}
	return n, true
}
