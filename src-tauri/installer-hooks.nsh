; Keep application binaries separate from %LOCALAPPDATA%\LostCodexTheme data.
; Tauri includes this file before defining PRODUCTNAME.
!define LCT_PRODUCT_NAME "LostCodexTheme"
!define MUI_CUSTOMFUNCTION_GUIINIT LctDefaultDirectory

Function LctDefaultDirectory
  StrCmp $INSTDIR "$LOCALAPPDATA\${LCT_PRODUCT_NAME}" 0 lct_directory_done
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${LCT_PRODUCT_NAME}"
  lct_directory_done:
FunctionEnd

; Remove Tauri's force-kill branch, including races after our preinstall check.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  nsis_tauri_utils::FindProcessCurrentUser "${executableName}"
  Pop $R0
  ${If} $R0 != 1
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Please restore Codex and exit LostCodexTheme before installing or uninstalling."
    Abort "LostCodexTheme must be closed through its own restore-and-exit workflow."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  Call LctDefaultDirectory
  GetFullPathName $R0 "$INSTDIR"
  GetFullPathName $R1 "$LOCALAPPDATA\${LCT_PRODUCT_NAME}"
  ${If} $R0 == $R1
    Abort "Choose an installation directory outside the theme data directory."
  ${EndIf}
  StrCpy $R2 "$R1\"
  StrLen $R3 $R2
  StrCpy $R4 $R0 $R3
  ${If} $R4 == $R2
    Abort "Choose an installation directory outside the theme data directory."
  ${EndIf}
  SetOutPath "$INSTDIR"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
!macroend
