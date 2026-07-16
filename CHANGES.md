# Profile Creation & Workspace Selection Improvements

## Summary of Changes

This update adds profile creation functionality and improves the workspace selection experience with native file pickers.

## New Features

### 1. Profile Creation Modal (`NewProfileModal.tsx`)
- **Profile Name Input**: Simple, user-friendly name for the profile
- **Authentication Type Selection**: 
  - Subscription: Shows a "Sign in with Anthropic" button
  - API Key: Shows a secure password field for API key input
- **Simplified UX**: Users don't need to know about internal concepts like "alias"
- **Visual Consistency**: Matches the existing design system

### 2. Visual Workspace Selection
- **Native File Picker**: Uses Finder (macOS) or Explorer (Windows) for folder selection
- **Read-only Input**: Displays selected path, prevents manual typos
- **Folder Icon Button**: Clear visual indicator for folder selection action

## Technical Changes

### Frontend
1. **New Component**: `src/components/NewProfileModal.tsx`
   - Handles profile creation with conditional UI based on auth type
   - Validates inputs before submission

2. **Updated Component**: `src/components/NewSessionModal.tsx`
   - Added folder picker button with Lucide icon
   - Integrated native directory selector
   - Read-only workspace path input

3. **Updated Component**: `src/App.tsx`
   - Added profile modal state management
   - Connected profile creation handler
   - Integrated NewProfileModal component

4. **Updated Component**: `src/components/Sidebar.tsx`
   - Displays profile names instead of aliases
   - Profile creation button is now functional

5. **Updated Types**: `src/types.ts`
   - Renamed `alias` to `name` in Profile interface
   - Added `selectDirectory()` to window.api interface
   - Updated createProfile signature

### Backend

1. **Database Schema**: `electron/db.ts`
   - Renamed `alias` column to `name` in profiles table
   - Added migration logic to handle existing databases
   - Safely migrates old data to new schema

2. **IPC Handlers**: `electron/main.ts`
   - Added `selectDirectory` handler using Electron's native dialog
   - Updated profile creation to use `name` instead of `alias`
   - Updated profile query to return `name` field

3. **Preload API**: `electron/preload.ts`
   - Exposed `selectDirectory()` method to frontend
   - Organized with "File System" section comment

## User Experience Improvements

### Before
- Users had to manually type workspace paths (error-prone)
- No profile creation UI (had to use external tools)
- Technical terminology ("alias") confused users

### After
- Visual folder picker with native OS dialogs
- Complete profile creation flow in the UI
- Simple, clear terminology ("name" instead of "alias")
- No exposure to internal implementation details

## Migration Support

The database migration automatically handles existing installations:
- Detects old `alias` column
- Safely migrates data to new `name` column
- Preserves all existing profile data
- No manual intervention required

## Testing

To test the changes:

1. **Profile Creation**:
   - Click the "+" icon next to "Profiles" in the sidebar
   - Enter a profile name
   - Select authentication type (Subscription or API Key)
   - For API Key: enter your Anthropic API key
   - Click "Create Profile"

2. **Session Creation with Folder Picker**:
   - Click "New Session" button or the "+" in the tab bar
   - Click the folder icon button
   - Select a workspace directory using the native file picker
   - Select a profile from the dropdown
   - Click "Start Session"

## Notes

- The OAuth login flow for subscriptions is marked as TODO (console.log placeholder)
- All changes maintain backward compatibility with existing sessions
- No breaking changes to the database structure
