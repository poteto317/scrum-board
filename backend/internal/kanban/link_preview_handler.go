package kanban

import (
	"net/http"
	"strings"
	"sync"
)

const maxLinkPreviewBatch = 20

type linkPreviewEntry struct {
	OK    bool   `json:"ok"`
	Title string `json:"title,omitempty"`
}

func (h handler) batchLinkPreviews(w http.ResponseWriter, r *http.Request) {
	if _, ok := CurrentUser(r.Context()); !ok {
		reply(w, http.StatusUnauthorized, map[string]string{"message": msgLoginRequired})
		return
	}
	var in struct {
		URLs []string `json:"urls"`
	}
	if !decode(w, r, &in) {
		return
	}
	// Bound before DNS (same raw-array cap as OpenAPI maxItems / error copy).
	if len(in.URLs) > maxLinkPreviewBatch {
		invalid(w, "一度に取得できるURLは20件までです。")
		return
	}
	seen := make(map[string]struct{}, len(in.URLs))
	var keys []string
	for _, raw := range in.URLs {
		trimmed := strings.TrimSpace(raw)
		if _, err := parseLinkPreviewURL(trimmed); err != nil {
			continue
		}
		// Key must match frontend normalizeDescriptionLinkUrl return (trimmed raw), not url.String().
		key := trimmed
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	previews := make(map[string]linkPreviewEntry, len(keys))
	if h.linkPreviewResolver == nil {
		for _, k := range keys {
			previews[k] = linkPreviewEntry{OK: false}
		}
		reply(w, 200, map[string]map[string]linkPreviewEntry{"previews": previews})
		return
	}
	type result struct {
		url   string
		title string
		ok    bool
	}
	ch := make(chan result, len(keys))
	var wg sync.WaitGroup
	for _, k := range keys {
		wg.Add(1)
		go func(pageURL string) {
			defer wg.Done()
			title, ok := h.linkPreviewResolver.Resolve(r.Context(), pageURL)
			ch <- result{url: pageURL, title: title, ok: ok}
		}(k)
	}
	wg.Wait()
	close(ch)
	for res := range ch {
		if res.ok {
			previews[res.url] = linkPreviewEntry{OK: true, Title: res.title}
		} else {
			previews[res.url] = linkPreviewEntry{OK: false}
		}
	}
	for _, k := range keys {
		if _, ok := previews[k]; !ok {
			previews[k] = linkPreviewEntry{OK: false}
		}
	}
	reply(w, 200, map[string]map[string]linkPreviewEntry{"previews": previews})
}
