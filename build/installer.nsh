!macro customInstall
  ; This is an x64 Electron application. Check the x64 VC++ v14 runtime first.
  ; The NSIS installer already requests elevation; ExecWait captures the real exit code.
  SetRegView 64
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  StrCmp $1 1 vcredist_already_installed

  SetOutPath "$PLUGINSDIR"
  File /oname=vc_redist.x64.exe "${PROJECT_DIR}\build\vc_redist.x64.exe"
  DetailPrint "Installing the required Microsoft Visual C++ x64 runtime..."
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $0

  ; 0 = success; 3010 = success, reboot recommended. Re-check registry for all results.
  StrCmp $0 "0" vcredist_verify
  StrCmp $0 "3010" vcredist_verify
  StrCmp $0 "1638" vcredist_verify
  Goto vcredist_failed

  vcredist_verify:
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  StrCmp $1 1 vcredist_done
  Goto vcredist_failed

  vcredist_already_installed:
  DetailPrint "Microsoft Visual C++ x64 runtime is already installed; skipping prerequisite installation."
  Goto vcredist_done

  vcredist_failed:
  MessageBox MB_ICONSTOP "NOUVO POS could not install or verify the Microsoft Visual C++ x64 runtime (exit code $0). Setup cannot safely continue. Restart Windows, run this installer as Administrator, and if it still fails install the official x64 runtime from https://aka.ms/vc14/vc_redist.x64.exe. If the runtime installer shows an error, send its exact error code to support."
  Abort

  vcredist_done:
!macroend
