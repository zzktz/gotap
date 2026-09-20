; GoTap must not terminate other desktop applications during an update or
; uninstall. This hook intentionally contains no global taskkill commands.
; The Tauri/NSIS installer handles the GoTap process and file replacement
; itself, while GoYou and other proxy applications continue running.
