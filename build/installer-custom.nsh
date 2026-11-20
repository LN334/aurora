; electron-builder keeps existing shortcuts when it upgrades an installed copy:
; with keepShortcuts enabled, addDesktopLink/addStartMenuLink only rename an
; existing .lnk and never recreate one that is gone. electron-updater runs the
; installer with --updated, so a shortcut removed by an earlier uninstall or by
; the user never comes back. Recreate the missing ones after a normal install.
;
; Desktop shortcut: fresh installs only.
; Upgrading never touches it - neither creating nor removing. If the user moved
; the icon into a desktop-organizer folder, the desktop path stays empty and a
; recreate-on-upgrade would add one more copy on every release.
!macro customInstall
  ; Desktop shortcut: fresh installs only.
  ;
  ; createDesktopShortcut 是 false，electron-builder 自己不会建——但这也意味着
  ; $newDesktopLink 这个变量不存在。以前这段被 !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
  ; 包着，而 electron-builder 恰好在 false 时定义那个宏，于是整段从来没被编译进去：
  ; 首装不建，升级也不建。这里自己拼路径，不再依赖那个变量。
  ;
  ; 升级时一律不碰：有人把图标收进了桌面整理器，每次升级再补一份就是多出来的。
  ${ifNot} ${isUpdated}
    ${ifNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${endIf}
  ${endIf}
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${ifNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
  !endif
!macroend
