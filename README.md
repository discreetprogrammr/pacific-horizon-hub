# Horizon Hub

Build a secure, enterprise-grade internal company resource portal for "Pacific Horizon Care" (portal.pacifichorizontek.com). The backend and database must be powered by Supabase.

1. DESIGN SYSTEM & UI
- Theme: Modern, clean, and professional. Inspired by modern healthcare and security technology dashboards, using a sophisticated palette (deep blues, clean whites, and subtle slate grays). It should feel related to the "Horizon Care 360" brand but modernized.
- Layout: A persistent sidebar navigation on desktop (collapsible on mobile) and a top header containing the user profile and a logout button.
- Components: Use glass-morphism cards for folders, clean data tables for file lists (showing File Name, Size, Date Uploaded, and Uploaded By), and clear status badges.

2. AUTHENTICATION & LOCKDOWN
- Hard Login Wall: The entire application must be locked behind authentication. Unauthenticated users must only see a branded login screen (Company Logo, Email, Password). 
- No Public Sign-ups: Disable user registration. Accounts can only be created by the database administrator.

3. PRE-SEED USERS & ROLES
Please configure the database with a user table/auth schema that includes a 'role' and 'department' column. Pre-seed or structure the logic for the following users:

Super Admins (Can read ALL folders, can upload to ALL folders):

- lal@phtek.com.ph
- rdh@phtek.com.ph
- pth@phtek.com.ph
- smp@phtek.com.ph 

Department-Restricted Users (Can ONLY read and upload to their specific department folder):

- gsc@phtek.com.ph (Department: Technical)
- info@phtek.com.ph (Department: Sales & Marketing)
- jmt@phtek.com.ph (Department: Sales & Marketing)
- marketing@phtek.com.ph (Department: Sales & Marketing)
- sales@phtek.com.ph (Department: Sales & Marketing)
- pst@phtek.com.ph (Department: HR and Admin)

4. FOLDER STRUCTURE & STORAGE
Create a secure file management interface with the following root folders:
- 📁 HR and Admin
- 📁 Sales & Marketing
- 📁 Technical Files (Manuals, Site Operations)

5. SECURITY & ACCESS CONTROL (SUPABASE RLS)
- Implement strict Row Level Security (RLS) policies on the Supabase Storage buckets and the file metadata tables.
- A user querying the dashboard should ONLY see the folders and files their role/department permits. 
- The UI must conditionally hide the "Upload File" button and drag-and-drop zones if a user navigates to a folder where they do not have upload privileges. 
- Storage buckets must be private. Files must only be accessible via securely signed URLs generated at the moment a permitted user clicks "Download". Direct file URLs must fail for non-logged-in users or unauthorized roles.

6. CORE FEATURES
- Dashboard: Upon login, a user sees a grid view of the folders they are permitted to access.
- File Browser: Clicking a folder opens a list view of files. Include breadcrumb navigation (e.g., Home > Technical Files).
- Upload Mechanism: A drag-and-drop zone with a progress bar for users with upload rights in that specific folder.
- File Actions: Permitted users can Download. Super Admins can Download and Delete.

Use the attached image as the main company logo in the top header and on the login screen.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/59427b7a-e31b-424b-b94b-ce1356abd0ab).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
