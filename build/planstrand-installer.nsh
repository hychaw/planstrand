# RC1 owns only the dedicated per-user directory. The directory-page option
# alone does not disable NSIS /D= or a previously registered unsafe location.
!macro PlanstrandRejectDestination
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "Planstrand RC1 requires its dedicated per-user directory. Custom destinations and non-empty directories without a hardened Planstrand installation are refused. No installation was performed."
  ${EndIf}
  SetErrorLevel 2
  Quit
!macroend

!macro customInit
  !insertmacro GetDParameter $R0
  ${If} $R0 != ""
    !insertmacro PlanstrandRejectDestination
  ${EndIf}

  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Planstrand"
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
  ${AndIf} $R0 != $INSTDIR
    !insertmacro PlanstrandRejectDestination
  ${EndIf}

  # Upgrade invokes the registered uninstaller before extracting files. Reject
  # orphaned/foreign entries rather than letting its fallback claim another path.
  ReadRegStr $R4 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R4 != ""
    ${If} $R0 != $INSTDIR
    ${OrIf} $R4 != '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser'
      !insertmacro PlanstrandRejectDestination
    ${EndIf}
  ${EndIf}

  # A non-empty directory requires provenance from this hardened installer.
  FindFirst $R1 $R2 "$INSTDIR\*"
  ${DoWhile} $R2 != ""
    ${If} $R2 != "."
    ${AndIf} $R2 != ".."
      ${If} $R0 != $INSTDIR
        FindClose $R1
        !insertmacro PlanstrandRejectDestination
      ${EndIf}
      ReadINIStr $R3 "$INSTDIR\planstrand-install.ini" "Planstrand" "AppId"
      ${If} $R3 != "${APP_ID}"
      ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${OrIfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
        FindClose $R1
        !insertmacro PlanstrandRejectDestination
      ${EndIf}
      ${ExitDo}
    ${EndIf}
    FindNext $R1 $R2
  ${Loop}
  FindClose $R1
!macroend

!macro customInstall
  WriteINIStr "$INSTDIR\planstrand-install.ini" "Planstrand" "AppId" "${APP_ID}"
!macroend

# Refuse uninstaller destination overrides too; preserve standard profile policy.
!macro customUnInit
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\Planstrand"
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadINIStr $R0 "$INSTDIR\planstrand-install.ini" "Planstrand" "AppId"
  ${If} $R0 != "${APP_ID}"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
