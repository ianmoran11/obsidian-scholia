-- Toggle mobile emulation in Obsidian
-- Usage: osascript emulate-mobile.applescript
tell application "Obsidian" to activate
delay 0.3
tell application "System Events"
    keystroke "p" using {command down}
    delay 0.5
    keystroke "Toggle mobile emulation"
    delay 0.3
    key code 36 -- return
end tell