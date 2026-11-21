package kanban

import "testing"

func TestSanitizeAttachmentAlt(t *testing.T) {
	if got := sanitizeAttachmentAlt("a]b\nc"); got != "abc" {
		t.Fatalf("got %q", got)
	}
	if got := sanitizeAttachmentAlt("  "); got != "image" {
		t.Fatalf("empty -> %q", got)
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
}
