@echo off
rem EDGE SCM management commands. Run from an Administrator command prompt in this folder.
rem   edge create-admin ^<email^> ^<name^>   edge import ^<folder^> [--dry-run]   edge reset-password ^<email^>   edge check
"%~dp0node\node.exe" --env-file="%~dp0config\edge.env" "%~dp0app\edge-cli.mjs" %*
