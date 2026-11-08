# ONE UI DESIGN SYSTEM & FRONTEND GUARDRAILS
## Canonical UI Specification & AI Agent Directives

> **Canonical Source of Truth:** `docs/ONE UI DESIGN.pdf`  
> **Academic / Industry Ecosystem:** Capstone 1 | BSIT 3-1 — Business Finance and Marketing Industry  
> **Target Subsystems:** Contract Management System (**CRMS** / CMS), Smart Expense Reimbursement Management System (**SERMS**), Productivity Report System (**PRS**), Ticketing System (**TS**), and Central Authentication Service & Web Interface (**Auth Module**).  
> **Reviewed By:** Cristian O. Balatbat, MIT (Capstone Adviser)

---

## 🧭 Figma MCP Integration & Live Component Inspection

When designing, prototyping, refining, or implementing UI components, AI agents and subagents should leverage the **Figma Dev Mode MCP Server** (`figma-dev-mode-mcp-server`) whenever visual clarification, exact component token parameters, or asset nodes are required.

- **Canonical Figma Project Link:**  
  `https://www.figma.com/design/ciWpnQzNBU3Zopv97v29nN/PRS?node-id=79-1078&t=vMI8xDhUbfkm564o-1`
- **MCP Server Identifier:** `figma-dev-mode-mcp-server` (Configured endpoint: `http://127.0.0.1:3845/mcp`)
- **Usage Instruction for AI Agents:**
  1. Whenever creating new frontend views, refactoring layouts, or building UI components, inspect the canonical Figma project via Figma MCP tools (`get_node`, `get_node_by_url`, `get_image`, etc.) to verify exact component geometry, padding, alignment, typography hierarchies, and states.
  2. If the local Figma MCP daemon is active on port `3845`, query node `79-1078` and surrounding canvas frames to extract the canonical ONE UI components (buttons, headers, navigation bars, modals, tables, badges).
  3. If Figma MCP is unavailable in the execution environment, strictly obey the rules and specifications defined in this document (`DESIGN.md`), which constitutes the frozen canonical source of truth extracted from `docs/ONE UI DESIGN.pdf`.

---

## 🛡️ Mandatory AI Guardrails for Frontend & UI Development

All AI agents and subagents (specifically `@ui-designer`, `@frontend-developer`, `@architect-reviewer`, and `@code-reviewer`) must strictly follow these non-negotiable guardrails:

1. **Zero Arbitrary Styling**: Never inject arbitrary ad-hoc Tailwind classes, spontaneous colors, or non-standard spacing (e.g. `p-[13px]`, `bg-[#2a4599]`, `h-[47px]`). Every visual property must originate from the tokens defined in this guide.
2. **Framework & Package Pinning**:
   - `web-interface` is built with **Vue 3 SPA**, **shadcn-vue** (Radix Vue primitives), and **Tailwind CSS 3.4**.
   - **DO NOT bump `web-interface` to Tailwind v4.** Do not introduce Tailwind v4 syntax into `web-interface`.
3. **Component Primitive Standard**: All interactive components (Modals, Dialogs, Selects, Dropdowns, Tooltips, Accordions) must be sourced from **shadcn-vue** headless primitives styled with Tailwind CSS. Never install or use third-party pre-styled widget libraries (e.g. Vuetify, Bootstrap, Element Plus, PrimeVue).
4. **Icon Standard**: Glyph assets must strictly and exclusively be sourced from **Lucide Icons** (`lucide-vue-next`). Do not import or mix FontAwesome, Material Icons, or raw unvetted SVGs.
5. **Strict 8px Spacing Hierarchy**: Every margin and padding must adhere to the 8px grid (`8px`, `16px`, `24px`, `32px`, `48px`). Arbitrary whitespace is strictly prohibited.
6. **Bifurcated Loading States**:
   - **Skeleton Loaders** are mandatory for layout rendering, content loading, and async data fetching (cards, tables, schedules, profiles).
   - **Spinner Graphics** (`Loader2` from `lucide-vue-next`) are reserved exclusively for action triggers, button submissions, and network uploads.
7. **Title Case Status Badges**: All status badge labels must use Title Case (e.g., `Active`, `Pending`, `Rejected`, `Approved`), never ALL-CAPS.
8. **Pre-Implementation Consultation**: Any subagent assigned a frontend task must first consult this document (`DESIGN.md`) and verify compliance before writing or modifying UI code.

---

## I. Logo & Brand Mark Specifications

### A. Corporate Logo
- **Asset Identifier:** `sbsi-variation1-logo.png`
- **Application:** Used on the main authentication landing page, homepage, and User Management sidebar representing the complete **Scientific Biotech Specialties, Inc.** organization.

### B. Favicon
- **Asset Identifier:** `sbsi-logo-white.png`
- **Application:** Used on the expanded sidebar/header of each group system (CMS, SERMS, PRS, TS) to maintain consistent SBSI enterprise identity across individual subsystem interfaces.

### C. System Logo
- **Asset Identifier:** `sbsi-logo-white.png`
- **Application:** Used on the collapsed sidebar/header of each group system (CMS, SERMS, PRS, TS).

### D. Subsystem Logo Lockups
Used on the sidebar/header of each individual subsystem (**PRS**, **SERMS**, **CMS/CRMS**, **TS**). It identifies the specific subsystem while retaining the core SBSI brand identity.
- **Brand Mark:** SBSI Variation 2.
- **Typography:** System names use **Poppins**.
  - **Identifying portion:** `Poppins Bold` (uppercase).
  - **Suffix portion:** `"System"` or `"Management System"` uses `Poppins Regular`, **1 font size smaller**, **0 letter spacing**, and **1 line spacing**, and must always appear as the last/bottom line.
- **Canonical Lockup Examples:**
  - `PRODUCTIVITY REPORTS` / `SYSTEM`
  - `CONTRACT` / `MANAGEMENT SYSTEM`
  - `SMART EXPENSE` / `REIMBURSEMENT MANAGEMENT SYSTEM`
  - `TICKETING` / `SYSTEM`

---

## II. Typography Standards

| Hierarchy / Usage | Font Family | Allowed Weights | Letter Spacing | Purpose & Guardrails |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Font** | **Poppins** (`font-sans`) | 400 (Regular), 600 (SemiBold), 700 (Bold) | Normal / Tight | Used for UI headings, H1–H4, button labels, badge text, table headers, sidebar navigation, form labels. |
| **Secondary Font** | **Montserrat** | 400 (Regular), 500 (Medium), 600 (SemiBold) | Normal | Used selectively for secondary numerical readouts, long-form helper typography, and peripheral copy. |

- Font fallbacks: `'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
- All headings (H1, H2, H3), modal titles, and navigation items must use **Poppins**.

---

## III. Canonical Colour Palette & Token System

Every color used across templates, components, and stylesheets must strictly align with the following canonical hex codes:

### Core Brand & Surface Tokens

| Token Name | Hex Code | Tailwind / CSS Mapping | Primary Purpose & Usage |
| :--- | :--- | :--- | :--- |
| **Brand Primary** | `#252578` | `bg-primary`, `text-[#252578]` | Sidebar background, page titles, main CTA buttons, badges, Donut chart approved slice. |
| **Brand Accent** | `#2E85D8` | `bg-secondary`, `text-[#2e85d8]` | Active sidebar border, focus rings, link hovers, badges, Donut chart pending slice. |
| **Brand Deep** | `#3A3A85` | `bg-[#3a3a85]` | Active sidebar link background, dark navy text utilities. |
| **Brand Deep Border** | `#4E4E91` | `border-[#4E4E91]` | Active sidebar link container background border. |
| **Page Background** | `#F8F9FA` | `bg-slate-50` / `bg-[#F8F9FA]` | Master body background, table `thead th` backgrounds, row hover highlights. |
| **Surface Pure White** | `#FFFFFF` | `bg-white`, `bg-card` | Main card backgrounds, modal dialogs, dropdowns, inputs, top header. |
| **Dark Slate** | `#1E293B` | `text-slate-800` / `text-[#1e293b]` | Card metric numbers, modal header titles, primary body typography, user display name in header. |
| **Medium/Muted Slate** | `#8D8B8F` | `text-[#8d8b8f]` | Secondary subtitles, table data cells, form helper copy. |
| **Brand Background** | `#EFF6FF` | `bg-blue-50` / `bg-[#eff6ff]` | Brand badges, chip backgrounds, active row selection highlights. |
| **Header Linear Gradient** | `#252578` to `#2E85D8` | `bg-gradient-to-r from-[#252578] to-[#2e85d8]` | Optional hero background headers and branded section banners. |

### Semantic Status Tokens

| Semantic State | Element / Purpose | Hex Code | Tailwind Utility |
| :--- | :--- | :--- | :--- |
| **Error / Destructive** | Text / Icon / Border Accent | `#EF4444` | `text-red-500`, `border-l-[#ef4444]` |
| | Background Pill / Card | `#FEF2F2` | `bg-red-50` |
| | Border / Field Ring | `#FCA5A5` | `border-red-300` |
| **Warning / Pending** | Text / Icon / Highlight | `#F59E0B` | `text-amber-500` |
| | Background Pill / Tag | `#FFFBEB` | `bg-amber-50` |
| | Warning Callout Border | `#FCD34D` | `border-amber-300` |
| | Persistent Banner Surface | `#FFFDF0` | `bg-[#fffdf0]` |
| | Persistent Banner Icon | `#D97706` | `text-amber-600` |
| **Success / Approved** | Text / Icon / Toggle | `#10B981` | `text-emerald-500`, `border-l-[#10b981]` |
| | Background Pill | `#ECFDF5` | `bg-emerald-50` |
| | Border | `#6EE7B7` | `border-emerald-300` |

### Specialized Contextual Colors
- **Header Avatar Circle:** `#A7A7C8` (Circular badge with white bold initials).
- **Portal Eyebrows & Subtitles:** `#8086A3` (Category labels, portal tracker, subtitle scope text).
- **Table Column Headers:** `#94A3B8` (Uppercase labels with expanded letter tracking).
- **Primary Button Hover:** `#2F2F8E` (`10%` lighter translucent shift).
- **Primary Button Pressed:** `#1E1E66` (`transform: scale(0.98)`).

---

## IV. Spacing & Sizing Hierarchy (8px Grid)

The layout strictly adheres to an **8px grid system**. Arbitrary margins and paddings are forbidden:

```
+---------------+---------------+------------------------------------------------------+
| Spacing Token | Pixel Value   | Primary Application                                  |
+---------------+---------------+------------------------------------------------------+
| 4px (p-1)     | 4px           | Micro element spacing, badges, tight tags            |
| 8px (m-2/p-2) | 8px           | Compact controls, buttons, status badges, icon gaps  |
| 12px (p-3)    | 12px          | Input padding, dropdown items                        |
| 16px (m-4/p-4)| 16px          | Form gutters, compact cards, side panel padding      |
| 24px (m-6/p-6)| 24px          | Primary vertical rhythm between cards, dialog pads   |
| 32px (m-8/p-8)| 32px          | Outer page canvas boundary padding                   |
| 48px (m-12)   | 48px          | Major section separators, landing section margins    |
+---------------+---------------+------------------------------------------------------+
```

### Margin Rules
- `8px`: Compact element separation (icon offsets, inline tags).
- `16px`: Form field gutters and grouped content stacks.
- `24px`: Primary vertical rhythm between cards and view sections.
- `32px`: Maximum outer canvas boundary margins.

### Padding Rules
- `8px`: Compact interactive controls, buttons, and status badges.
- `16px`: Mobile containers, side panels, and compact cards.
- `24px`: Standard internal padding for cards, tables, and dialogs.
- `32px`: Desktop outer page container padding.

---

## V. Elevation & Shadow Levels

| Level | CSS Box Shadow Definition | Tailwind Mapping | Target UI Elements |
| :--- | :--- | :--- | :--- |
| **Level 1** | `0 1px 2px 0 rgba(0, 0, 0, 0.05)` | `shadow-sm` | Metric Cards, Badges, Table Rows |
| **Level 2** | `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.06)` | `shadow-md` | Dropdowns, Hover Cards, Popovers, Action Menus |
| **Level 3** | `0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.05)` | `shadow-lg` | Toast Notifications, Drawers, Side Panels |
| **Level 4** | `0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.08)` | `shadow-2xl` | Modals, Dialogs, Critical Action Overlays |

---

## VI. Component Standardization & Layout Specifications

### 1. Sidebar Component (Expanded & Collapsed)

#### Anatomy & Dimensions
- **Background:** Solid Brand Primary (`#252578`).
- **Border Radius:** Right edge `rounded-r-3xl` (or straight full-height fixed nav).
- **Z-Index:** Fixed viewport height, `z-30`.

#### Header & Brand Lockup
- **System Logo (`sbsi-logo-white.png`)**: Positioned at top.
- **Subsystem Name:** Poppins Bold for system name, Poppins Regular for "System" / "Management System", 1 font size smaller, 0 letter spacing, 1 line spacing, bottom line.
- **Divider:** Subtle 1px border line directly below brand header (`border-b border-white/10`).

#### Category Section Eyebrows
- Small, non-clickable header text: `rgba(255, 255, 255, 0.6)`, uppercase, bold, reduced opacity (e.g. `MAIN`, `ANALYTICS`, `GENERAL`).

#### Navigation Items (Single Items)
- **Default State:** Transparent background, leading Lucide icon, semi-bold Poppins label in `rgba(255, 255, 255, 0.6)`. Hover: `hover:bg-white/10`.
- **Active State:** Solid container pill background Brand Deep (`#3A3A85`), with border Brand Deep Border (`#4E4E91`), rounded corners (`8px` / `rounded-lg`), white bold text label (`#FFFFFF`).

#### Accordion Navigation Items (With Children)
- **Collapsed:** Transparent background, leading icon, label, right-aligned down chevron (`ChevronDown`).
- **Expanded / Active:** Solid container pill `rgba(255, 255, 255, 0.15)` or `#3A3A85`, `rounded-lg`, right-aligned up chevron (`ChevronUp`).
- **Submenu Tree Indicator:** Child links render underneath with left indentation. A thin vertical guide line (`border-l: 1px solid rgba(255, 255, 255, 0.2)`) connects parent to children.
- **Child Items:**
  - Inactive: `rgba(255, 255, 255, 0.70)`.
  - Active: `#FFFFFF` with SemiBold weight.

#### Pinned Footer (Logout Action)
- Fixed at the bottom of the sidebar.
- Preceded by a full-width subtle divider line (`1px solid rgba(255, 255, 255, 0.2)`).
- LogOut icon (`#FFFFFF`) with Bold label `"Logout"` (`#FFFFFF`).

#### Collapsed Sidebar Rules
- Centered horizontally (`justify-content: center`, `items-center`).
- Completely hide brand wordmark, section eyebrows, text labels, chevrons, and nested accordion menus.
- Only visible: Centered logo, centered nav icons, centered bottom logout icon.
- Default state: `text-white/80`. Active state: Highlighted centered square container.

---

### 2. Top Header Component

- **Surface:** Solid pure white (`#FFFFFF`) with drop shadow (`shadow-sm`) or backdrop blur (`bg-white/90 backdrop-blur-md`).
- **Layout:** Full-width flex container aligning navigation controls to the left and user utilities to the right.

#### Left Section
- **Sidebar Toggle Button:** Lucide `PanelLeft` icon button toggling expanded/collapsed modes.
- **Vertical Divider:** Subtle 1px separator (`h-6 w-px bg-slate-200`).
- **Page Title:** Poppins Bold (700), Dark Slate (`#1E293B`), text size `18px–20px`.

#### Right Section
- **Notification Button:** Bell icon button with solid blue circular unread badge (`#2E85D8`, `rounded-full`) displaying white bold unread count.
- **Vertical Divider:** Subtle 1px separator (`h-6 w-px bg-slate-200`).
- **User Profile Card (Dropdown Trigger):**
  - **Circular Avatar Badge:** Solid background `#A7A7C8`, white bold user initials.
  - **User Display Name:** Poppins SemiBold, Dark Slate (`#1E293B`).
  - **User Role:** Poppins Regular (400), Dark Slate (`#1E293B`) or Muted Slate (e.g., `Supervisor`, `Manager`, `System Admin`).
  - **Interaction State:** Entire user card acts as single interactive trigger (`cursor-pointer`). On hover: `hover:bg-slate-100/80`, `rounded-xl`.
- **User Profile Dropdown Menu:**
  - Floats `8px` below header, aligned to the trigger card.
  - White surface with Level 2 elevation shadow (`shadow-md`).
  - Navigation links: `My Profile`, `Back to Home`.
  - Divider: Subtle 1px horizontal divider line directly above Logout.
  - Logout Item: Destructive red styling (`text-red-600 hover:bg-red-50`).
  - Dismissal: Auto-closes on click outside (backdrop dismiss), item selection, or Escape key.

---

### 3. Page Layouts & Headers

#### Pattern A: Dashboard Page Header (Home / Executive Views)
- Reserved exclusively for home dashboard views (Salesperson, Supervisor, and Admin portals).
- **Portal Eyebrow:** Small uppercase badge/tracker in bold `#8086A3` (e.g., `SUPERVISOR PORTAL`).
- **Greeting Title (H1):** Time-aware greeting in Poppins Bold (700), `24px–26px` (e.g., `"Good morning, Sales and Marketing Supervisor!"`).
- **Subtitle:** 1-line scope description in `#8086A3`.
- **Right-Aligned Real-Time Clock:**
  - Live Time: Bold (700), Dark Slate (`#1E293B`), formatted as `HH:mm:ss A`.
  - Live Date: Regular (400), Muted Slate (`#8086A3`), formatted as `dddd, MMMM D, YYYY`.

#### Pattern B: Standard Page Header (All Functional Views)
- Used for all entity listings, tables, management, and functional views.
- **No Portal Eyebrow & No Real-Time Clock:** Maximizes vertical content space.
- **Page Title (H1):** Poppins Bold (700), `24px`, Dark Slate (`#1E293B`) (e.g., `"User Management"`, `"Validation Queue"`).
- **Subtitle:** Concise 1-line description of the specific screen in `#8086A3`.
- **Action Toolbar:** Right-aligned contextual actions (e.g., `+ Create User`, `Export Data`, `Filter`).

---

### 4. Summary Metric Cards

- **Surface:** Pure white (`#FFFFFF`), borderless, `14px` rounded corners (`rounded-[14px]`).
- **Elevation:** Level 1 soft ambient drop shadow (`shadow-sm`).
- **Hover State:** Deepens shadow to `shadow-md` with a subtle upward lift (`hover:-translate-y-1 transition-all duration-200`).
- **Card Content Anatomy:**
  1. **Top:** Small `#8086A3` Poppins category label.
  2. **Center:** Prominent bold `#1E293B` numerical readout (`text-2xl` or `text-3xl font-bold`).
  3. **Bottom Left:** Fully rounded percentage trend pill (`text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600` or `bg-red-50 text-red-600`).
  4. **Bottom Right:** Right-aligned circular badge containing an entity icon (Lucide icon). Circular badge and icon colors adapt to subsystem context.

---

### 5. Action Confirmation Modal Dialogs

- **Geometry & Surface:** Focused modal window centered over a darkened backdrop blur (`bg-slate-900/50 backdrop-blur-sm`). Built on pure white borderless surfaces with large rounded corners (`rounded-2xl`) and Level 4 elevation (`shadow-2xl`).
- **Header Structure:** Strictly centered to draw immediate focus.
  - **Status Icon Badge:** Centered circular badge on top, tinted in soft background matching semantic intent (e.g. soft red for delete, soft mint for approve).
  - **Title:** Bold Poppins title (`text-xl font-bold text-slate-800`).
  - **Description:** Muted description explaining exact consequences.
- **Contextual Body Variants:**
  - *Standard Confirmation:* Text-only description.
  - *High-Security Action:* Labeled password confirmation input field.
  - *Rejection Workflow:* Mandatory multiline reason textarea (`textarea` with placeholder and validation).
  - *Pre-Submission Confirmation:* Soft blue tinted summary card displaying key entity metadata.
- **Centered Action Footer:**
  - Horizontally centered at bottom of modal with button gap.
  - **Cancel Button:** Neutral light gray outline button.
  - **Primary Action Button:** Color-coded:
    - Destructive / Delete / Reject: Solid Red (`#EF4444`).
    - Workflow Approval: Solid Emerald (`#10B981`).
    - Record Creation / General: Solid Brand Navy (`#252578`).

---

### 6. Form & Creation Modals

- **Header Section:** Left-aligned header layout.
  - Soft blue circular badge containing an accent icon.
  - Bold Poppins title paired with muted subtitle explaining the form objective.
  - Full-width subtle horizontal divider line (`border-b border-slate-100`) beneath header block.
- **Form Layout & Field Validation:**
  - Grid: Flexible grid supporting both 2-column paired inputs and full-width rows.
  - Eyebrows: Every field identified by an uppercase eyebrow label in bold/semi-bold.
  - Field States:
    - *Default:* Neutral subtle border (`border-slate-200`).
    - *Active / Focus:* Active Brand Accent border (`2px solid #2E85D8`) with soft glow ring (`ring-2 ring-[#2E85D8]/20`).
    - *Validation Failure:* Solid Red border (`border-red-500`) with an inline error message in red text directly below the field.
- **Drag & Drop File Upload Area:**
  - Container: Dedicated dropzone with dashed border (`border-2 border-dashed border-slate-300`), rounded corners (`rounded-xl`), generous padding (`p-6`).
  - Content: Centered circular cloud upload icon, bold Poppins prompt ("Click to upload or drag & drop"), uppercase caption outlining accepted file formats (`PDF, DOCX, PNG, or JPG — MAX 10 MB`).
- **Right-Aligned Action Footer:**
  - Bottom-right aligned with gap.
  - Soft neutral gray Cancel button alongside solid Brand Navy (`#252578`) Confirm button.
  - Disabled state with spinner graphic during data transmission.

---

### 7. Select Dropdown Component

- **Trigger:** Clean white surface, rounded border (`rounded-lg border-slate-200`), trailing down chevron (`ChevronDown`).
  - When active/opened: Brand Accent border (`2px solid #2E85D8`).
- **Dropdown Panel:**
  - Expands directly beneath trigger container with zero gap.
  - Anchored to the width of the input field.
  - Solid white surface, bottom-rounded corners, Level 2 elevation (`shadow-md`), high z-index.
- **Option Item States:**
  - *Selected / Active:* Solid Brand Accent background (`#2E85D8`) with crisp white Poppins text (`#FFFFFF`).
  - *Unselected:* Dark slate text on white background, smoothly transitioning to soft gray highlight on hover (`hover:bg-slate-100`).
- **Dismissal:** Automatically dismisses on outside click or `Escape` key.

---

### 8. Toast Notification Component

- **Position & Geometry:** Lightweight floating white cards anchored strictly at the **Top-Right corner of the viewport**:
  ```css
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 1200;
  ```
- **Structure:**
  - `12px–14px` rounded corners, Level 3 ambient drop shadow (`shadow-lg`).
  - Solid **4px vertical accent strip** along the left edge.
  - Circular pastel status badge housing an outline Lucide icon.
  - Bold, uppercase Poppins typography in high-contrast dark text.
  - Clickable close icon (`X`) on the right edge.
- **Animation & Timing:**
  - Horizontal slide-in entrance from right (`translate-x`).
  - Auto-dismiss countdown timer of **4 seconds**.
  - **Timer automatically pauses** when cursor hovers over the toast card.
- **Semantic States:**
  - **Success:** `border-l-4 border-l-[#10B981]`, soft mint circular badge, emerald checkmark.
  - **Error / Danger:** `border-l-4 border-l-[#EF4444]`, soft rose circular badge, red cross icon.

#### Canonical Toast Copy Reference Table

AI agents must strictly utilize the following standardized message strings for system notifications:

| Trigger Event | Semantic Type | Standardized Toast Message |
| :--- | :--- | :--- |
| Submission Approval | Success | `Submission Approved: The activity log was approved successfully.` |
| Record Creation | Success | `RECORD ADDED SUCCESSFULLY` |
| User Creation | Success | `User "{name}" has been successfully added!` |
| User Update | Success | `User "{name}" has been successfully updated!` |
| User Status Change | Success | `User "{name}" status updated successfully!` |
| Validator Config | Success | `Validator configuration for {department} updated successfully!` |
| Dropdown Settings | Success | `{label} "{name}" has been successfully added/updated!` |
| Status Update | Success | `Status updated successfully!` |
| No User Changes | Info | `No changes detected for this user.` |
| No Dropdown Changes | Info | `No changes detected for this {product/institution}.` |
| Duplicate Detected | Warning | `DUPLICATE DETECTED, THIS RECORD ALREADY EXIST.` |
| Submission Rejection| Error | `Submission Rejected: The submission log was rejected and remarks were saved.` |
| User Save Failure | Error | `Failed to save user` |
| Item Save Failure | Error | `Failed to save item` |

---

### 9. Inline Alert Banners & In-Page Warnings

- **Persistent Warning Banner (Callout Container):**
  - Designed for critical workflow conditions (e.g. pending supervisor acknowledgments).
  - Background: Soft warm amber (`#FFFDF0`).
  - Border: Solid amber (`#FCD34D`, `1px solid`).
  - Icon: Circular exclamation icon in `#D97706`.
  - Typography: Medium-weight Poppins in amber text.
  - Persistence: **Strictly persistent.** Stays on screen until condition is cleared. Never auto-dismisses.
- **Minimal Inline Warning (Micro-Feedback):**
  - Lightweight, borderless inline warning directly beneath form controls or upload areas.
  - Icon: Triangle warning icon in `#D97706`.
  - Prompt: Concise Poppins prompt (e.g. `"Please attach a record."`).

---

### 10. Data Tables & Contextual Filter Panel

- **Section Header & Toolbar:**
  - Section title in bold Poppins with dynamic total record counter (e.g., `All Listings (67)`).
  - Left-aligned search input with magnifying glass (`Search` icon).
  - Dedicated `Filters` toggle button with outline funnel icon (`Filter`).
  - Right-aligned primary creation button styled in solid Brand Navy (`#252578`).
- **Table Architecture & Row Anatomy:**
  - Column Headers: Uppercase Poppins, bold, expanded letter tracking, Muted Slate (`#94A3B8`).
  - Sort Indicators: Dual-caret clickable indicator (`↕` default, `▲` ascending, `▼` descending).
  - Minimum Row Height: `56px` minimum height with subtle horizontal bottom dividers (`border-b border-slate-100`).
  - Cell Typography:
    - Primary entity / contact names: Bold Dark Slate (`#1E293B`).
    - Categories & secondary info: Neutral Gray.
    - Dates & timestamps: Stacked across two lines (Date on line 1, Time on line 2).
    - Status indicators: Rounded semantic pills.
    - Representative / user cells: `28px` circular navy avatar badge paired with stacked two-line name and role display.
- **Row-Level Action Menu:**
  - Rightmost column provides a vertical three-dot trigger icon (`MoreVertical`).
  - Clicking opens a compact floating dropdown menu (View activity logs, Edit, Trigger confirmation dialogs for deletion/rejection).
- **Contextual Filter Side Panel:**
  - Clicking `Filters` toggle reveals an anchored side panel adjacent to table.
  - Uppercase eyebrow labels, select dropdowns for category/filter/status, start and end date inputs with calendar icons.

---

### 11. Status Badges & Semantic Pill Tags

- **Pill Anatomy & Geometry:**
  - Container: Fully rounded pill container (`rounded-full`).
  - Height: Fixed `24px` to `28px`.
  - Padding: `10px` to `14px` horizontal padding (`px-3 py-1`).
  - Typography: Bold `12px` Poppins (`text-xs font-semibold`).
  - Real-Time Indicators: Active sessions may integrate a `6px` solid circular dot indicator positioned directly left of label.
  - **Rule:** Badges must always be rendered in **Title Case** (`Active`, `Pending`, `Approved`, `Rejected`), never all-caps.
- **Three Visual Emphasis Tiers:**
  1. **High-Emphasis Tier:** Solid vibrant fill with bold white text. Used strictly for hero cards and modal summaries.
  2. **Medium-Emphasis Tier:** Light pastel background with matching `1px` border. Standardized for table rows.
  3. **Low-Emphasis Tier:** Borderless soft tinted wash for dense data grids.
  - *Consistency Rule:* Within any single data table column, all rows must standardize on the same visual tier (preferably medium-emphasis or low-emphasis).
- **Semantic Color Mapping:**
  - **Emerald Green:** Active and approved records.
  - **Warm Amber:** Pending approvals, awaiting supervisor review.
  - **Crimson Red:** Rejections, cancellations, validation errors.
  - **Sky Blue:** Informational notices.
  - **Vibrant Violet:** Specialized role categories and client tiers.
  - **Muted Slate Gray:** Archived or inactive records.

---

## VII. Interaction & Micro-Feedback State Matrix

| Component | State | Visual Styling & Interactive Behavior |
| :--- | :--- | :--- |
| **Primary Button**<br>(Brand Navy) | **Default** | Solid Brand Navy (`#252578`), bold white Poppins text, `shadow-sm`, `rounded-md` |
| | **Hover** | 10% lighter shift (`bg-primary/90` / `#2F2F8E`), cursor pointer |
| | **Active / Pressed** | Darkened compression (`#1E1E66`), subtle scale compression (`transform: scale(0.98)`) |
| | **Focused** | Accessible 2px outline ring offset (`focus-visible:ring-2 focus-visible:ring-[#2E85D8]`) |
| | **Loading** | Pointer events disabled (`pointer-events-none`), 70% opacity, Lucide spinning `Loader2` icon |
| | **Disabled** | 50% opacity, flat background (`#94A3B8`), `cursor-not-allowed`, zero pointer events |
| **Destructive Button**<br>(Red / Delete / Reject) | **Default** | Solid Red (`#EF4444`), bold white text, `rounded-md` |
| | **Hover** | 10% darker red (`bg-destructive/90` / `#DC2626`), cursor pointer |
| | **Active / Pressed** | Deep crimson (`#B91C1C`), `transform: scale(0.98)` |
| | **Focused** | Red focus ring offset (`focus-visible:ring-2 focus-visible:ring-red-400`) |
| | **Loading** | 70% opacity, spinning white loader icon, pointer events blocked |
| | **Disabled** | 50% opacity, muted soft red, `cursor-not-allowed` |
| **Outline / Secondary Button** | **Default** | Pure white background (`#FFFFFF`), 1px gray border (`#CBD5E1`), dark slate text (`#1E293B`) |
| | **Hover** | Soft gray background shift (`#F8FAFC` / `hover:bg-slate-100`), border shifts to `#94A3B8` |
| | **Active / Pressed** | Slightly deeper gray (`#F1F5F9`), inward click feel |
| | **Focused** | Brand Accent focus ring (`#2E85D8`) |
| | **Loading** | Muted border and spinner icon inside |
| | **Disabled** | Gray border at 50% opacity, text color `#94A3B8`, `cursor-not-allowed` |
| **Table Rows**<br>(`<tbody> <tr>`) | **Default** | Pure white background (`#FFFFFF`), 1px bottom border (`#F1F5F9`) |
| | **Hover** | 3% subtle cool-gray background shift (`#F8FAFC` / `hover:bg-slate-50`) |
| | **Active / Selected**| Soft brand blue tint (`#EFF6FF` / `bg-blue-50/60`) indicating active selection |
| | **Focused** | Keyboard tab focus highlights row perimeter with a 1px dashed blue outline |
| | **Loading** | Replaced by animated shimmer skeleton rows |
| | **Disabled** | Row opacity reduced to 40% with disabled cursor for inactive records |
| **Dropdown Option Items** | **Default** | Transparent background, dark slate text (`#1E293B`), 10px vertical padding |
| | **Hover** | Soft gray highlight (`#F1F5F9` / `bg-slate-100`), text sharpens to `#0F172A` |
| | **Active / Selected**| Solid Brand Accent background (`#2E85D8`), text turns pure white (`#FFFFFF`) |
| | **Focused** | Automatic keyboard focus matches hover styling (`bg-slate-100`) |
| | **Disabled** | 40% opacity, non-clickable (`pointer-events-none`) |

---

## VIII. Loading States Standardization

To maintain visual harmony, loading patterns are strictly bifurcated:

```
               +---------------------------------------+
               |        SYSTEM LOADING PATTERNS        |
               +---------------------------------------+
                                  |
         +------------------------+------------------------+
         |                                                 |
         v                                                 v
+-------------------------------+             +-------------------------------+
|       SKELETON LOADERS        |             |        SPINNER GRAPHICS       |
|    (Structure & Data Fetch)   |             |     (Actions & Submissions)   |
+-------------------------------+             +-------------------------------+
| - Dashboard Metric Cards      |             | - Action Modal Confirmations  |
| - Data Listings & Tables      |             | - Save / Delete / Submit CTA  |
| - Leaderboard & Ranking Views |             | - Session Actions (Login/Out) |
| - Agenda & Schedule Cards     |             | - File Upload Dropzone Upload |
| - Validator Department Grids  |             | - Inline Form Commit Buttons  |
| - Attachment Viewer Thumbnails|             +-------------------------------+
| - Mobile Record Cards         |
+-------------------------------+
```

1. **Skeleton Shimmers:** Must match the exact layout geometry of the target component (e.g. 5-column shimmer for data tables, card skeleton for metric cards).
2. **Action Spinners:** Must use Lucide `Loader2` with `animate-spin`. In buttons, prefix the existing label or temporarily replace it while maintaining the button's exact bounding box dimensions to prevent layout shifts.

---

## IX. Multi-Agent Delegation & Team Orchestration

When organizing multi-agent teams for frontend, UI, or design work, invoke the proper subagents according to this capability mapping:

| Subagent Role | Primary Focus & Domain | When to Invoke |
| :--- | :--- | :--- |
| **`@agent-organizer`** | Team assembly, workflow design, dependency mapping, task decomposition. | When initiating complex frontend epics, organizing multi-agent handoffs, and managing cross-subsystem dependencies. |
| **`@ui-designer`** | Visual design, design systems, tokens, Figma MCP queries, component aesthetics, accessibility. | When defining component specifications, extracting Figma node properties, designing visual states, auditing contrast. |
| **`@frontend-developer`** | Vue 3, TypeScript, Vite, Tailwind 3.4, shadcn-vue, component architecture, state management. | When writing `.vue` components, implementing layouts, wiring router and stores, building views according to `DESIGN.md`. |
| **`@architect-reviewer`** | High-level system architecture, cross-subsystem contracts, security boundaries. | When reviewing frontend-to-backend API contracts, auth token handoffs, and shared gateway routing. |
| **`@code-reviewer`** | Code quality, PSR-12/ESLint, design system compliance audit, PR review. | Prior to submitting pull requests, ensuring all UI code strictly adheres to `DESIGN.md`. |
| **`@qa-expert`** | Test strategy, Cypress/Playwright E2E, Vitest component testing, UI validation. | Writing test suites for UI workflows, form validations, modal confirmations, and responsive viewports. |

---

## X. Compliance & Review Checklist for AI Subagents

Before completing any frontend or UI task, the responsible subagent must execute this verification checklist:

- [ ] **Canonical Colors**: Are all colors using the exact hex codes from Section III? (No unauthorized blues or grays).
- [ ] **Typography**: Are all labels, headings, and buttons using `Poppins`? Is `Montserrat` restricted to numerical/secondary copy?
- [ ] **Spacing**: Are all margins and paddings divisible by 8px? (4px only for compact badges).
- [ ] **Icons**: Are all icons imported exclusively from `lucide-vue-next`?
- [ ] **Loading States**: Are skeleton loaders used for data fetching and `Loader2` spinners used for button submissions?
- [ ] **Elevations**: Do shadows match Level 1 (`shadow-sm`) through Level 4 (`shadow-2xl`)?
- [ ] **Status Badges**: Are badge labels in Title Case? Is a single emphasis tier used per table column?
- [ ] **Toasts**: Do toast notifications appear in the Top-Right (`top: 24px; right: 24px; z-index: 1200;`) with 4px left accent bar and 4-second hover-paused timer?
- [ ] **Tailwind 3.4**: Did the agent preserve Tailwind 3.4 compatibility without using Tailwind 4 features in `web-interface`?
- [ ] **Figma Reference**: Was Figma MCP (`https://www.figma.com/design/ciWpnQzNBU3Zopv97v29nN/PRS?node-id=79-1078&t=vMI8xDhUbfkm564o-1`) consulted for any ambiguous component specs?
