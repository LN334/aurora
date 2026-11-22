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

; ---------------------------------------------------------------------------
; 卸载时问一句要不要连数据一起删。
;
; deleteAppDataOnUninstall 是 false：卸载只删程序，账号会话、曲库索引、设置都留在
; %APPDATA%\aurora-player。这是对的默认——重装回来还是原来那套。但有些人卸载就是
; 为了清干净，不该让他们自己去翻隐藏目录。
;
; 默认按「否」（MB_DEFBUTTON2），连点回车不会误删。
; ---------------------------------------------------------------------------
!macro customUnInstall
  ; electron 的数据一直在当前用户的 roaming 下，即使安装是给所有用户装的。
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  IfFileExists "$APPDATA\${APP_FILENAME}\*.*" 0 aurora_skipUserData
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否一并删除账号与设置？$\r$\n$\r$\n保存在：$APPDATA\${APP_FILENAME}$\r$\n$\r$\n选「否」则保留，下次安装会自动接着用。" \
    /SD IDNO IDYES aurora_deleteUserData
  Goto aurora_skipUserData

  aurora_deleteUserData:
    RMDir /r "$APPDATA\${APP_FILENAME}"

  aurora_skipUserData:
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

; ---------------------------------------------------------------------------
; 安装程序被放进安装目录里时拦下。
;
; electron-builder 判断「应用是否在运行」是按进程路径以 $INSTDIR 开头匹配的；一个
; 放在 $INSTDIR 里的安装程序会把自己认成正在运行的 Aurora，然后一直等自己退出，
; 界面卡在「正在关闭」不动。这里先看自己是不是在安装目录里，是就提示挪走。
;
; 定义 customCheckAppRunning 会跳过模板自己 include 的 getProcessInfo.nsh，
; 所以这里要自己把它和 pid 变量带进来。
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
  !include "getProcessInfo.nsh"
  Var pid

  !macro customCheckAppRunning
    StrLen $R0 "$INSTDIR\"
    StrCpy $R1 "$EXEDIR\" $R0
    ${if} $R1 == "$INSTDIR\"
      MessageBox MB_OK|MB_ICONSTOP \
        "安装程序位于安装目录内：$\r$\n$INSTDIR$\r$\n$\r$\n请把它移到其他位置（例如桌面或下载文件夹）后再运行。" \
        /SD IDOK
      Quit
    ${endif}

    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !macroend
!endif
