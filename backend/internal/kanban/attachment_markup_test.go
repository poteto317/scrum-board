package kanban

import (
	"strings"
	"testing"
)

func TestSanitizeAttachmentAlt(t *testing.T) {
	if got := sanitizeAttachmentAlt("a]b\nc"); got != "abc" {
		t.Fatalf("got %q", got)
	}
	if got := sanitizeAttachmentAlt("  "); got != "image" {
		t.Fatalf("empty -> %q", got)
	}
	if got := sanitizeAttachmentName("  ", "file"); got != "file" {
		t.Fatalf("empty file fallback -> %q", got)
	}
}

func TestStripAttachmentMarkup(t *testing.T) {
	text := "before ![pic](/api/items/by-number/7/attachments/3/content) after"
	got := stripAttachmentMarkup(text, 7, 3)
	if got != "before  after" {
		t.Fatalf("got %q", got)
	}
	unchanged := stripAttachmentMarkup(text, 7, 9)
	if unchanged != text {
		t.Fatalf("other id stripped: %q", unchanged)
	}
	fileText := "before [doc](/api/items/by-number/7/attachments/3/content) after"
	if got := stripAttachmentMarkup(fileText, 7, 3); got != "before  after" {
		t.Fatalf("file markup got %q", got)
	}
	if got := stripAttachmentMarkup(fileText, 7, 9); got != fileText {
		t.Fatalf("other id file stripped: %q", got)
	}
}

func TestBuildFileAttachmentMarkup(t *testing.T) {
	got := BuildFileAttachmentMarkup(2, 9, "a]b\nc")
	want := "[abc](/api/items/by-number/2/attachments/9/content)"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if got := BuildFileAttachmentMarkup(2, 9, "  "); got != "[file](/api/items/by-number/2/attachments/9/content)" {
		t.Fatalf("empty -> %q", got)
	}
}

func TestValidateAttachmentMIME(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0}
	if err := validateAttachmentMIME("image/png", png); err != nil {
		t.Fatal(err)
	}
	if err := validateAttachmentMIME("image/jpeg", png); err == nil {
		t.Fatal("magic mismatch should fail")
	}
	if err := validateAttachmentMIME("image/svg+xml", png); err == nil {
		t.Fatal("disallowed mime should fail")
	}
	pdf := []byte("%PDF-1.4\n%")
	if err := validateAttachmentMIME("application/pdf", pdf); err != nil {
		t.Fatal(err)
	}
	if err := validateAttachmentMIME("application/pdf", png); err == nil {
		t.Fatal("pdf declared with png magic should fail")
	}
	if err := validateAttachmentMIME("image/png", pdf); err == nil {
		t.Fatal("png declared with pdf magic should fail")
	}
	if err := validateAttachmentMIME("text/html", pdf); err == nil {
		t.Fatal("disallowed html should fail")
	}
	if err := validateAttachmentMIME("application/pdf", nil); err == nil {
		t.Fatal("empty magic should fail")
	}
	if err := validateAttachmentMIME("application/pdf", []byte("%PD")); err == nil {
		t.Fatal("short non-pdf magic should fail")
	}
}

func TestContentDispositionAttachment(t *testing.T) {
	got := contentDispositionAttachment("報告.pdf\r\n\"x\\y", "application/pdf")
	if !strings.HasPrefix(got, "attachment; filename=\"") {
		t.Fatalf("prefix: %q", got)
	}
	if strings.Contains(got, "\r") || strings.Contains(got, "\n") {
		t.Fatalf("unsafe chars in header: %q", got)
	}
	if !strings.Contains(got, "filename*=UTF-8''") {
		t.Fatalf("missing filename*: %q", got)
	}
	start := strings.Index(got, `filename="`) + len(`filename="`)
	end := strings.Index(got[start:], `"`)
	fallback := got[start : start+end]
	if strings.ContainsAny(fallback, "\"\\\r\n") {
		t.Fatalf("fallback unsafe: %q", fallback)
	}
	spoof := contentDispositionAttachment("evil.html", "application/pdf")
	if !strings.Contains(spoof, ".pdf") || strings.Contains(spoof, "evil.html\"") {
		t.Fatalf("pdf must force .pdf suffix: %q", spoof)
	}
}
