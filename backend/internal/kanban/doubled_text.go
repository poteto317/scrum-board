package kanban

// collapseExactDoubledText folds s while it is exactly half+half on the rune
// axis, up to maxFolds times. hitLimit is true when maxFolds was reached and
// the result is still doubled.
func collapseExactDoubledText(s string, maxFolds int) (out string, folds int, hitLimit bool) {
	if maxFolds < 0 {
		maxFolds = 0
	}
	out = s
	for folds < maxFolds {
		half, ok := exactDoubledHalf(out)
		if !ok {
			return out, folds, false
		}
		out = half
		folds++
	}
	if _, still := exactDoubledHalf(out); still {
		return out, folds, true
	}
	return out, folds, false
}

func exactDoubledHalf(s string) (string, bool) {
	r := []rune(s)
	n := len(r)
	if n < 2 || n%2 != 0 {
		return "", false
	}
	half := n / 2
	if string(r[:half]) != string(r[half:]) {
		return "", false
	}
	return string(r[:half]), true
}
