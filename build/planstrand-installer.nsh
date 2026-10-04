!include LogicLib.nsh
!include FileFunc.nsh
# No recursive uninstall: files added after installation are retained.
!include "${BUILD_RESOURCES_DIR}\..\.tmp\planstrand-remove-files.nsh"
Var PlanstrandRegisteredDir
Var PlanstrandCheckPath
Var PlanstrandRelative
Var PlanstrandSafe
Var PlanstrandUninstall

!macro PlanstrandRejectDestination
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "Choose a new or empty folder, or an existing Planstrand installation. Folders containing unrelated files, repositories or links cannot be used. No installation was performed."
  ${EndIf}
  SetErrorLevel 2
  Quit
!macroend

!macro PlanstrandLoadManifest
  InitPluginsDir
  File /oname=$PLUGINSDIR\planstrand-install-files.ini "${BUILD_RESOURCES_DIR}\..\.tmp\planstrand-install-files.ini"
!macroend

# Identical checks for selection, /D= and registered upgrades.
!macro PlanstrandFunctions PREFIX
Function ${PREFIX}PlanstrandCheckTree
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  FindFirst $R1 $R2 "$PlanstrandCheckPath\$PlanstrandRelative*"
  ${DoWhile} $R2 != ""
    ${If} $R2 != "."
    ${AndIf} $R2 != ".."
      ReadINIStr $R3 "$PLUGINSDIR\planstrand-install-files.ini" "Owned" "$PlanstrandRelative$R2"
      System::Call 'kernel32::GetFileAttributesW(w "$PlanstrandCheckPath\$PlanstrandRelative$R2") i .s'
      Pop $R4
      IntOp $R4 $R4 & 0x400
      ${If} $R4 != 0
      ${OrIf} $R2 == ".git"
        StrCpy $PlanstrandSafe 0
        ${ExitDo}
      ${ElseIf} $PlanstrandUninstall != "1"
      ${AndIf} $R3 != "1"
        StrCpy $PlanstrandSafe 0
        ${ExitDo}
      ${EndIf}
      ${If} ${FileExists} "$PlanstrandCheckPath\$PlanstrandRelative$R2\*"
        Push $PlanstrandRelative
        StrCpy $PlanstrandRelative "$PlanstrandRelative$R2\"
        Call ${PREFIX}PlanstrandCheckTree
        Pop $PlanstrandRelative
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R2
  ${Loop}
  FindClose $R1
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
FunctionEnd

Function ${PREFIX}PlanstrandCheckDestination
  StrCpy $PlanstrandSafe 0
  Push $0
  System::Call 'kernel32::GetFullPathNameW(w "$PlanstrandCheckPath", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i .s'
  Pop $R2
  StrCpy $R0 $0
  Pop $0
  ${If} $R2 == 0
  ${OrIf} $R2 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $R0 != $PlanstrandCheckPath
    Return
  ${EndIf}
  ${GetRoot} "$R0" $R1
  ${If} $R0 == $R1
  ${OrIf} $R0 == "$R1\"
    Return
  ${EndIf}
  # Refuse files, junctions and reparse points, including ancestors.
  StrCpy $R1 $R0
  ${DoWhile} $R1 != ""
    ${If} ${FileExists} "$R1\.git"
      Return
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w "$R1") i .s'
    Pop $R2
    ${If} $R2 != -1
      IntOp $R3 $R2 & 0x400
      IntOp $R2 $R2 & 0x10
      ${If} $R3 != 0
      ${OrIf} $R2 == 0
        Return
      ${EndIf}
    ${EndIf}
    ${GetParent} "$R1" $R1
  ${Loop}
  StrCpy $PlanstrandSafe 1
  FindFirst $R1 $R2 "$PlanstrandCheckPath\*"
  ${DoWhile} $R2 != ""
    ${If} $R2 != "."
    ${AndIf} $R2 != ".."
      ReadINIStr $R3 "$PlanstrandCheckPath\planstrand-install.ini" "Planstrand" "AppId"
      ${If} $PlanstrandRegisteredDir != $PlanstrandCheckPath
      ${OrIf} $R3 != "${APP_ID}"
      ${OrIfNot} ${FileExists} "$PlanstrandCheckPath\${APP_EXECUTABLE_FILENAME}"
      ${OrIfNot} ${FileExists} "$PlanstrandCheckPath\${UNINSTALL_FILENAME}"
        StrCpy $PlanstrandSafe 0
      ${Else}
        StrCpy $PlanstrandRelative ""
        Call ${PREFIX}PlanstrandCheckTree
      ${EndIf}
      ${ExitDo}
    ${EndIf}
    FindNext $R1 $R2
  ${Loop}
  FindClose $R1
FunctionEnd
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro PlanstrandFunctions "un."
  !else
    !insertmacro PlanstrandFunctions ""
  !endif
!macroend

!macro customInit
  !insertmacro PlanstrandLoadManifest
  StrCpy $PlanstrandUninstall 0
  # Refuse unsafe registrations before uninstallOldVersion, even with a safe /D=.
  ReadRegStr $PlanstrandRegisteredDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R4 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $PlanstrandRegisteredDir != ""
    ${If} $R4 != '"$PlanstrandRegisteredDir\${UNINSTALL_FILENAME}" /currentuser'
      !insertmacro PlanstrandRejectDestination
    ${EndIf}
    StrCpy $PlanstrandCheckPath $PlanstrandRegisteredDir
    Call PlanstrandCheckDestination
    ${If} $PlanstrandSafe != 1
      !insertmacro PlanstrandRejectDestination
    ${EndIf}
  ${ElseIf} $R4 != ""
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R4 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R0 != ""
  ${OrIf} $R4 != ""
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
  !insertmacro GetDParameter $R0
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${ElseIf} $PlanstrandRegisteredDir != ""
    StrCpy $INSTDIR $PlanstrandRegisteredDir
  ${Else}
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Planstrand"
  ${EndIf}
  StrCpy $PlanstrandCheckPath $INSTDIR
  Call PlanstrandCheckDestination
  ${If} $PlanstrandSafe != 1
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
!macroend

# The assisted template normalizes the selection in instFilesPre. Validate the
# final path before old-version removal or extraction; silent paths were checked in init.
!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE PlanstrandBeforeInstall
  Function PlanstrandBeforeInstall
    Call instFilesPre
    StrCpy $PlanstrandCheckPath $INSTDIR
    Call PlanstrandCheckDestination
    ${If} $PlanstrandSafe != 1
      !insertmacro PlanstrandRejectDestination
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  WriteINIStr "$INSTDIR\planstrand-install.ini" "Planstrand" "AppId" "${APP_ID}"
!macroend

!macro customUnInit
  !insertmacro PlanstrandLoadManifest
  # Unknown ordinary files are retained by the exact removal list. Repositories
  # and links still refuse uninstall rather than traversing a foreign target.
  StrCpy $PlanstrandUninstall 1
  ReadRegStr $PlanstrandRegisteredDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $INSTDIR != $PlanstrandRegisteredDir
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
  ReadINIStr $R0 "$INSTDIR\planstrand-install.ini" "Planstrand" "AppId"
  ${If} $R0 != "${APP_ID}"
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
  StrCpy $PlanstrandCheckPath $INSTDIR
  Call un.PlanstrandCheckDestination
  ${If} $PlanstrandSafe != 1
    !insertmacro PlanstrandRejectDestination
  ${EndIf}
  # Uninstall uses the compiled list; unrelated additions are never removed.
!macroend
