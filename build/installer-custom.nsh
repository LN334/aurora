; electron-builder keeps existing shortcuts when it upgrades an installed copy:
; with keepShortcuts enabled, addDesktopLink/addStartMenuLink only rename an
; existing .lnk and never recreate one that is gone. electron-updater runs the
; installer with --updated, so a shortcut removed by an earlier uninstall or by
; the user never comes back. Recreate the missing ones after a normal install.
!macro customInstall
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
  !endif
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${ifNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
  !endif
!macroend
