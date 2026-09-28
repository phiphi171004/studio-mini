Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

electronCmd = scriptDir & "\node_modules\.bin\electron.cmd"

If fso.FileExists(electronCmd) Then
    cmd = "cmd /c """"" & electronCmd & """ ."""
    WshShell.Run cmd, 0, False
Else
    cmd = "cmd /c pnpm exec electron ."
    WshShell.Run cmd, 0, False
End If
