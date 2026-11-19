package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
)

// openServiceLog opens the log in append mode and hands the *os.File straight
// to the child, so output lands on disk without a pipe that fhubd must drain.
// Rotation only happens at (re)start; a service that logs heavily while
// staying up grows past maxBytes until its next restart.
func openServiceLog(path string, maxBytes int64) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if fi, err := os.Stat(path); err == nil && maxBytes > 0 && fi.Size() > maxBytes {
		_ = os.Rename(path, path+".1")
	}
	return os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
}

// tailFile returns the last n lines, reading backwards in chunks so a large
// log costs only what is returned. truncated reports that older lines exist.
func tailFile(path string, n int) (data []byte, truncated bool, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, false, err
	}
	const chunk = 64 << 10
	const maxRead = 32 << 20
	size := fi.Size()
	var buf []byte
	pos := size
	for pos > 0 && size-pos < maxRead {
		step := int64(chunk)
		if pos < step {
			step = pos
		}
		pos -= step
		part := make([]byte, step)
		if _, err := f.ReadAt(part, pos); err != nil && err != io.EOF {
			return nil, false, err
		}
		buf = append(part, buf...)
		// n+1 newlines guarantees n complete lines even when the file ends in "\n".
		if bytes.Count(buf, []byte{'\n'}) > n {
			break
		}
	}
	trimmed := bytes.TrimSuffix(buf, []byte{'\n'})
	lines := 0
	for i := len(trimmed) - 1; i >= 0; i-- {
		if trimmed[i] == '\n' {
			lines++
			if lines == n {
				return buf[i+1:], true, nil
			}
		}
	}
	if pos > 0 {
		// Cut at maxRead: drop the partial first line.
		if i := bytes.IndexByte(buf, '\n'); i >= 0 {
			return buf[i+1:], true, nil
		}
	}
	return buf, false, nil
}
