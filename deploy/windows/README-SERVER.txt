EDGE SCM - installing on your Windows Server
==============================================

Everything runs on YOUR server: the program, the database and the backups.
Nothing is sent to any outside cloud service.


1. WHAT YOU NEED
----------------
- Windows Server 2016, 2019 or 2022 (or Windows 10/11 Pro for a small trial).
  Suggested: 4 CPU cores, 8 GB RAM, 100 GB free disk, on all the time.
- PostgreSQL 16 for Windows (free): https://www.postgresql.org/download/windows/
  Use the official installer, keep port 5432, and write down the password you
  choose for the "postgres" user.
- Optional but recommended: an HTTPS certificate for the server's name, as a
  .pfx file, from your IT provider. Without one, the installer creates a
  self-signed certificate for testing (browsers will show a warning).


2. INSTALL (about 15 minutes)
-----------------------------
1. Unzip this package to C:\EDGE-SCM (or another folder on the server).
2. Install PostgreSQL 16 (see above) if it is not installed yet.
3. Open PowerShell with "Run as administrator", then:
       cd C:\EDGE-SCM
       powershell -ExecutionPolicy Bypass -File .\install.ps1
   Answer the questions (postgres password, company name, certificate, port).
4. Create the first administrator:
       .\edge.cmd create-admin you@yourcompany.ae "Your Name"
   It prints a temporary password. You will choose your own at first sign-in.
5. Open https://SERVERNAME (the address the installer shows) from an office PC.


3. LOAD YOUR COMPANY'S DATA
---------------------------
The folder "templates" has one CSV file per list. Open each one in Excel,
fill it in, and save it as "CSV UTF-8". "templates\example" shows the format.

  companies.csv         clients, consultants, suppliers, subcontractors
  projects.csv          your projects (client, consultant, dates, contract value)
  sites.csv             sites / areas of each project
  locations.csv         warehouses and site stores
  cost_codes.csv        your cost codes
  items.csv             materials you order (units, pack sizes)
  users.csv             your staff: email, name, roles, projects
  consultant_codes.csv  each consultant's approval codes, per project

Roles you can use in users.csv (separate several with |):
  director, operations_manager, project_manager, site_engineer, foreman,
  document_controller, procurement_officer, storekeeper, quantity_surveyor,
  accountant, management_viewer, admin

Check first, then load:
    .\edge.cmd import templates --dry-run
    .\edge.cmd import templates
Nothing is saved if any row has a problem; every problem is listed with its
row number. You can run the import again at any time to add or change things.

New staff get a temporary password, saved in a file named
templates\temporary-passwords-<date>.csv. Give each person theirs privately,
then DELETE that file. Each person must choose their own password at first
sign-in. Forgotten password:  .\edge.cmd reset-password person@yourcompany.ae


4. ACCESS FROM SITES AND PHONES
-------------------------------
Recommended now: VPN.
  Site engineers connect their phone or laptop to the office VPN (the VPN of
  your office firewall/router, for example FortiGate, Sophos or WireGuard),
  then open https://SERVERNAME. The system is never exposed to the internet.

Later, without VPN (only with a proper certificate):
  Point a name such as edge.yourcompany.ae to your office internet address,
  forward port 443 on the office firewall to this server, and install a
  certificate for that name. Do this only after two-step sign-in is added,
  because the sign-in page would then be reachable from the internet.


5. BACKUPS (automatic)
----------------------
- Every night at 01:30 the database is saved to C:\EDGE-SCM\backups
  (30 days are kept). Task Scheduler: "EDGE SCM daily backup".
- IMPORTANT: also keep a copy away from this server. Set BACKUP_COPY_TO in
  config\edge.env to a NAS or another server share, e.g. \\nas\EDGE-Backups
- Once a month, prove a backup can be restored (does not touch live data):
    powershell -ExecutionPolicy Bypass -File .\restore-test.ps1 -DumpFile .\backups\<newest>.dump
- Run a backup by hand at any time:
    powershell -ExecutionPolicy Bypass -File .\backup.ps1


6. UPDATING TO A NEW VERSION
----------------------------
1. Run a backup by hand (see above).
2. Unzip the new version over C:\EDGE-SCM (keep the config, backups and logs
   folders: they are not in the zip).
3. Run install.ps1 again as administrator. It keeps your settings, upgrades
   the database and restarts the service.


7. IF SOMETHING GOES WRONG
-------------------------
- Service status: Windows "Services" app, "EDGE SCM". It restarts by itself
  if it stops.
- Logs: C:\EDGE-SCM\logs (send the newest files to support).
- Check the database:   .\edge.cmd check
- Remove the service (keeps data):  .\uninstall.ps1

Disaster recovery (new or repaired server):
  1. Install PostgreSQL 16 and unzip EDGE SCM as in section 2.
  2. Copy your old config\edge.env into the new config folder.
  3. Create the empty database (as the postgres user, in psql):
       CREATE ROLE edge LOGIN PASSWORD '<the password inside edge.env>';
       CREATE DATABASE edge OWNER edge ENCODING 'UTF8' TEMPLATE template0;
  4. Restore the newest backup:
       "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -h localhost --no-owner --role=edge -d edge <backup file>
  5. Run install.ps1 as administrator.


Settings file: config\edge.env (database password, port, certificate).
Only Administrators and SYSTEM can read it. Keep a copy with your backups.
