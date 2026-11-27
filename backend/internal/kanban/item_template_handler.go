package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

func failItemTemplate(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, 404, map[string]string{"message": "テンプレートが見つかりません。"})
		return
	}
	fail(w, err)
}

func (h handler) requireItemTemplateProjectID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	pid, ok, err := optionalQueryProjectID(r)
	if err != nil {
		invalid(w, "projectId は正の整数で指定してください。")
		return 0, false
	}
	if !ok {
		invalid(w, "projectId を指定してください。")
		return 0, false
	}
	projects, listErr := h.repo.ListProjects(r.Context())
	if listErr != nil {
		fail(w, listErr)
		return 0, false
	}
	if !projectIDExists(projects, pid) {
		failProject(w, ErrNotFound)
		return 0, false
	}
	return pid, true
}

func itemTemplatePathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "テンプレートIDが不正です。")
		return 0, false
	}
	return n, true
}

func (h handler) listItemTemplates(w http.ResponseWriter, r *http.Request) {
	pid, ok := h.requireItemTemplateProjectID(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListItemTemplatesEnsuringSeeds(r.Context(), pid)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			failProject(w, err)
			return
		}
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]ItemTemplate{"templates": list})
}

func (h handler) createItemTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	pid, ok := h.requireItemTemplateProjectID(w, r)
	if !ok {
		return
	}
	var in ItemTemplateInput
	if !decode(w, r, &in) {
		return
	}
	name, ok := NormalizeItemTemplateName(in.Name)
	if !ok {
		invalid(w, "名前は1〜60文字で、制御文字を含めず入力してください。")
		return
	}
	title, ok := NormalizeItemTemplateTitle(in.TitleTemplate)
	if !ok {
		invalid(w, "タイトル雛形は1〜200文字で、制御文字を含めず入力してください。")
		return
	}
	desc, ok := NormalizeItemTemplateDescription(in.DescriptionTemplate)
	if !ok {
		invalid(w, "説明雛形は10000文字以内で入力してください。")
		return
	}
	in.Name, in.TitleTemplate, in.DescriptionTemplate = name, title, desc
	created, err := h.repo.CreateItemTemplate(r.Context(), pid, in)
	if err != nil {
		failItemTemplate(w, err)
		return
	}
	reply(w, 201, created)
}

func (h handler) updateItemTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	pid, ok := h.requireItemTemplateProjectID(w, r)
	if !ok {
		return
	}
	id, ok := itemTemplatePathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name                json.RawMessage `json:"name"`
		TitleTemplate       json.RawMessage `json:"titleTemplate"`
		DescriptionTemplate json.RawMessage `json:"descriptionTemplate"`
	}
	if !decode(w, r, &body) {
		return
	}
	var patch ItemTemplatePatch
	if len(body.Name) > 0 {
		name, valid := normalizeItemTemplateField(body.Name, NormalizeItemTemplateName)
		if !valid {
			invalid(w, "名前は1〜60文字で、制御文字を含めず入力してください。")
			return
		}
		patch.Name = &name
	}
	if len(body.TitleTemplate) > 0 {
		title, valid := normalizeItemTemplateField(body.TitleTemplate, NormalizeItemTemplateTitle)
		if !valid {
			invalid(w, "タイトル雛形は1〜200文字で、制御文字を含めず入力してください。")
			return
		}
		patch.TitleTemplate = &title
	}
	if len(body.DescriptionTemplate) > 0 {
		desc, valid := normalizeItemTemplateField(body.DescriptionTemplate, NormalizeItemTemplateDescription)
		if !valid {
			invalid(w, "説明雛形は10000文字以内で入力してください。")
			return
		}
		patch.DescriptionTemplate = &desc
	}
	if patch.Name == nil && patch.TitleTemplate == nil && patch.DescriptionTemplate == nil {
		invalid(w, "name・titleTemplate・descriptionTemplate のいずれかを指定してください。")
		return
	}
	updated, err := h.repo.UpdateItemTemplate(r.Context(), pid, id, patch)
	if err != nil {
		failItemTemplate(w, err)
		return
	}
	reply(w, 200, updated)
}

func (h handler) deleteItemTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	pid, ok := h.requireItemTemplateProjectID(w, r)
	if !ok {
		return
	}
	id, ok := itemTemplatePathID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteItemTemplate(r.Context(), pid, id); err != nil {
		failItemTemplate(w, err)
		return
	}
	w.WriteHeader(204)
}

func normalizeItemTemplateField(raw json.RawMessage, normalize func(string) (string, bool)) (string, bool) {
	if string(raw) == "null" {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return normalize(value)
}
