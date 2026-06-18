' Launch-CommandCenter.vbs
' Starts the ADO Command Center tray host with no console window.
' Used as the target of the Desktop / Start-Menu / Startup shortcut. Any extra
' arguments (e.g. --silent for the Startup shortcut) are forwarded to node.
' Double-launching is safe: command-center-tray.js detects an already-running
' instance and just opens the board.
Dim fso, sh, dir, extra, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next
' window style 0 = hidden, False = do not wait
sh.Run "node """ & dir & "\command-center-tray.js""" & extra, 0, False
