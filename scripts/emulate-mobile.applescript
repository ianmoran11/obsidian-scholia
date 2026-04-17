tell application "Obsidian" to activate
tell application "System Events"
    keystroke "p" using {command down}
    delay 0.4
    keystroke "Toggle mobile emulation"
    delay 0.2
    key code 36
end tell