' Launch-CommandCenter.vbs
' Starts the ADO Command Center tray host with no console window.
' Used as the target of the Desktop / Start-Menu / Startup shortcut.
' Double-launching is safe: command-center-tray.js detects an already-running
' instance and just opens the board.
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' window style 0 = hidden, False = do not wait
sh.Run "node """ & dir & "\command-center-tray.js""", 0, False
