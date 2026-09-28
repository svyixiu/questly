// The "dummy game" Questly launches. Discord detects it by its file name and
// path; this window is just a small, friendly status card for the player.
//
// Built with /NODEFAULTLIB (no C runtime), so everything beyond kernel32/
// user32/gdi32 is loaded at run time, and GDI+ is used through its flat API.
//
// Command line (all optional):
//   --title "Game name"   window title and heading
//   --icon "C:\...\icon.png"
//   --colors bg,ink,muted,line,btn,btnInk,accent,danger   (hex RRGGBB, Questly's theme)
//   --hidden              no window and no tray icon (Questly's Auto hide)
//   --show                open on screen (default: parked just off-screen)
//
// Exit codes tell Questly why the game ended:
//   0 = closed, 2 = "Close & delete" (Questly then removes this game's files)

#include <windows.h>
#include <shellapi.h>

#define WM_TRAY_MESSAGE   (WM_USER + 1)
#define ID_TRAY_EXIT      1003
#define ID_TRAY_TOGGLE    1004
// Sent by Questly (Settings > game windows / Auto hide) to hide/show running runners
#define WM_DQC_HIDE       (WM_APP + 2)
#define WM_DQC_SHOW       (WM_APP + 3)

#define EXIT_CLOSED       0
#define EXIT_DELETE       2

#define TIMER_TICK        1

// ---------------------------------------------------------------- CRT stand-ins

// no optimizing here: the loops could otherwise be turned back into memset/memcpy calls
#pragma optimize("", off)
extern "C" {
    int _fltused = 0;

    #pragma function(memset)
    void* memset(void* dest, int c, size_t count) {
        char* bytes = (char*)dest;
        while (count--) *bytes++ = (char)c;
        return dest;
    }

    #pragma function(memcpy)
    void* memcpy(void* dest, const void* src, size_t count) {
        char* d = (char*)dest;
        const char* s = (const char*)src;
        while (count--) *d++ = *s++;
        return dest;
    }
}
#pragma optimize("", on)

// ---------------------------------------------------------------- GDI+ flat API

typedef int GpStatus;
struct GdiplusStartupInputX { UINT32 GdiplusVersion; void* DebugEventCallback; BOOL SuppressBackgroundThread; BOOL SuppressExternalCodecs; };
struct RectFX { float X, Y, Width, Height; };

typedef GpStatus(WINAPI* P_GdiplusStartup)(ULONG_PTR*, const GdiplusStartupInputX*, void*);
typedef GpStatus(WINAPI* P_GdipCreateFromHDC)(HDC, void**);
typedef GpStatus(WINAPI* P_GdipDeleteGraphics)(void*);
typedef GpStatus(WINAPI* P_GdipSetInt)(void*, int);
typedef GpStatus(WINAPI* P_GdipCreateSolidFill)(DWORD, void**);
typedef GpStatus(WINAPI* P_GdipDelete)(void*);
typedef GpStatus(WINAPI* P_GdipCreatePen1)(DWORD, float, int, void**);
typedef GpStatus(WINAPI* P_GdipCreatePath)(int, void**);
typedef GpStatus(WINAPI* P_GdipAddPathArc)(void*, float, float, float, float, float, float);
typedef GpStatus(WINAPI* P_GdipFillPath)(void*, void*, void*);
typedef GpStatus(WINAPI* P_GdipFillEllipse)(void*, void*, float, float, float, float);
typedef GpStatus(WINAPI* P_GdipLoadImageFromFile)(const WCHAR*, void**);
typedef GpStatus(WINAPI* P_GdipDrawImageRect)(void*, void*, float, float, float, float);
typedef GpStatus(WINAPI* P_GdipSetClipPath)(void*, void*, int);
typedef GpStatus(WINAPI* P_GdipCreateFontFamilyFromName)(const WCHAR*, void*, void**);
typedef GpStatus(WINAPI* P_GdipCreateFont)(void*, float, int, int, void**);
typedef GpStatus(WINAPI* P_GdipCreateStringFormat)(int, LANGID, void**);
typedef GpStatus(WINAPI* P_GdipDrawString)(void*, const WCHAR*, int, void*, const RectFX*, void*, void*);

struct {
    P_GdiplusStartup Startup;
    P_GdipCreateFromHDC CreateFromHDC;
    P_GdipDelete DeleteGraphics, DeleteBrush, DeletePen, DeletePath, DisposeImage, DeleteFont, DeleteFontFamily, DeleteStringFormat, ClosePathFigure, ResetClip;
    P_GdipSetInt SetSmoothingMode, SetPixelOffsetMode, SetTextRenderingHint, SetInterpolationMode;
    P_GdipSetInt SetStringFormatAlign, SetStringFormatLineAlign, SetStringFormatTrimming, SetStringFormatFlags;
    P_GdipCreateSolidFill CreateSolidFill;
    P_GdipCreatePen1 CreatePen1;
    P_GdipCreatePath CreatePath;
    P_GdipAddPathArc AddPathArc;
    P_GdipFillPath FillPath, DrawPath;
    P_GdipFillEllipse FillEllipse;
    P_GdipLoadImageFromFile LoadImageFromFile;
    P_GdipDrawImageRect DrawImageRect;
    P_GdipSetClipPath SetClipPath;
    P_GdipCreateFontFamilyFromName CreateFontFamilyFromName;
    P_GdipCreateFont CreateFont;
    P_GdipCreateStringFormat CreateStringFormat;
    P_GdipDrawString DrawString;
} gp;

BOOL LoadGdiPlus() {
    HMODULE m = LoadLibraryW(L"gdiplus.dll");
    if (!m) return FALSE;
#define GP(field, name) *(FARPROC*)&gp.field = GetProcAddress(m, name); if (!gp.field) return FALSE;
    GP(Startup, "GdiplusStartup");
    GP(CreateFromHDC, "GdipCreateFromHDC");
    GP(DeleteGraphics, "GdipDeleteGraphics");
    GP(DeleteBrush, "GdipDeleteBrush");
    GP(DeletePen, "GdipDeletePen");
    GP(DeletePath, "GdipDeletePath");
    GP(DisposeImage, "GdipDisposeImage");
    GP(DeleteFont, "GdipDeleteFont");
    GP(DeleteFontFamily, "GdipDeleteFontFamily");
    GP(DeleteStringFormat, "GdipDeleteStringFormat");
    GP(ClosePathFigure, "GdipClosePathFigure");
    GP(ResetClip, "GdipResetClip");
    GP(SetSmoothingMode, "GdipSetSmoothingMode");
    GP(SetPixelOffsetMode, "GdipSetPixelOffsetMode");
    GP(SetTextRenderingHint, "GdipSetTextRenderingHint");
    GP(SetInterpolationMode, "GdipSetInterpolationMode");
    GP(SetStringFormatAlign, "GdipSetStringFormatAlign");
    GP(SetStringFormatLineAlign, "GdipSetStringFormatLineAlign");
    GP(SetStringFormatTrimming, "GdipSetStringFormatTrimming");
    GP(SetStringFormatFlags, "GdipSetStringFormatFlags");
    GP(CreateSolidFill, "GdipCreateSolidFill");
    GP(CreatePen1, "GdipCreatePen1");
    GP(CreatePath, "GdipCreatePath");
    GP(AddPathArc, "GdipAddPathArc");
    GP(FillPath, "GdipFillPath");
    GP(DrawPath, "GdipDrawPath");
    GP(FillEllipse, "GdipFillEllipse");
    GP(LoadImageFromFile, "GdipLoadImageFromFile");
    GP(DrawImageRect, "GdipDrawImageRect");
    GP(SetClipPath, "GdipSetClipPath");
    GP(CreateFontFamilyFromName, "GdipCreateFontFamilyFromName");
    GP(CreateFont, "GdipCreateFont");
    GP(CreateStringFormat, "GdipCreateStringFormat");
    GP(DrawString, "GdipDrawString");
#undef GP
    GdiplusStartupInputX input = { 1, NULL, FALSE, FALSE };
    ULONG_PTR token = 0;
    return gp.Startup(&token, &input, NULL) == 0;
}

// ---------------------------------------------------------------- other late-bound APIs

typedef BOOL(WINAPI* P_Shell_NotifyIconW)(DWORD, PNOTIFYICONDATAW);
typedef HRESULT(WINAPI* P_DwmSetWindowAttribute)(HWND, DWORD, LPCVOID, DWORD);
typedef BOOL(WINAPI* P_SetProcessDPIAware)(void);
P_Shell_NotifyIconW f_Shell_NotifyIconW;

// ---------------------------------------------------------------- state

wchar_t g_szGameName[256] = L"Questly";
wchar_t g_szIconPath[MAX_PATH] = L"";
NOTIFYICONDATAW nid = { 0 };
BOOL g_hidden = FALSE;      // --hidden: no window, no tray icon
BOOL g_show = FALSE;        // --show: open on screen instead of parked off-screen
BOOL g_iconShown = FALSE;
BOOL g_gdiplus = FALSE;
int g_exitCode = EXIT_CLOSED;
int g_dpi = 96;
ULONGLONG g_started = 0;
void* g_icon = NULL;        // GpImage*
int g_hover = 0;            // 0 none, 1 Close, 2 Close & delete
int g_pressed = 0;
BOOL g_tracking = FALSE;
RECT g_btnClose = { 0 }, g_btnDelete = { 0 };

// Questly's default "Espresso" palette; replaced by --colors
struct Theme { DWORD bg, ink, muted, line, btn, btnInk, accent, danger; };
Theme C = { 0xFF1A1916, 0xFFF2ECE0, 0xFF9A9285, 0xFF4A4640, 0xFFEFE7D7, 0xFF1A1916, 0xFFCFDD7A, 0xFFF07C6C };

#define WIN_SIZE 300        // logical px; the window is square
int S(int v) { return MulDiv(v, g_dpi, 96); }
float SF(float v) { return v * (float)g_dpi / 96.0f; }

// ---------------------------------------------------------------- small helpers

wchar_t* FindStringW(const wchar_t* str, const wchar_t* substr) {
    while (*str) {
        const wchar_t* h = str, * n = substr;
        while (*h && *n && *h == *n) { h++; n++; }
        if (!*n) return (wchar_t*)str;
        str++;
    }
    return NULL;
}

// Copies the value after `flag` (quoted or bare) into `out`.
BOOL GetArg(const wchar_t* cmd, const wchar_t* flag, wchar_t* out, int cap) {
    wchar_t* pos = FindStringW(cmd, flag);
    if (!pos) return FALSE;
    pos += lstrlenW(flag);
    while (*pos == L' ') pos++;
    int i = 0;
    if (*pos == L'"') {
        pos++;
        while (*pos && *pos != L'"' && i < cap - 1) out[i++] = *pos++;
    } else {
        while (*pos && *pos != L' ' && i < cap - 1) out[i++] = *pos++;
    }
    out[i] = 0;
    return i > 0;
}

int HexDigit(wchar_t c) {
    if (c >= L'0' && c <= L'9') return c - L'0';
    if (c >= L'a' && c <= L'f') return c - L'a' + 10;
    if (c >= L'A' && c <= L'F') return c - L'A' + 10;
    return -1;
}

// "1a1916,f2ece0,..." -> the Theme fields, in order
void ParseColors(const wchar_t* s) {
    DWORD* fields = (DWORD*)&C;
    int count = sizeof(Theme) / sizeof(DWORD);
    for (int f = 0; f < count && *s; f++) {
        DWORD rgb = 0;
        int n = 0;
        while (n < 6) {
            int d = HexDigit(*s);
            if (d < 0) break;
            rgb = (rgb << 4) | (DWORD)d;
            s++; n++;
        }
        if (n == 6) fields[f] = 0xFF000000 | rgb;
        while (*s && *s != L',') s++;
        if (*s == L',') s++;
    }
}

// blends two ARGB colors: t = 0..255 toward b
DWORD Mix(DWORD a, DWORD b, int t) {
    DWORD out = 0xFF000000;
    for (int shift = 0; shift <= 16; shift += 8) {
        int ca = (a >> shift) & 0xFF, cb = (b >> shift) & 0xFF;
        out |= (DWORD)((ca + (cb - ca) * t / 255) & 0xFF) << shift;
    }
    return out;
}

DWORD WithAlpha(DWORD c, int alpha) { return (c & 0x00FFFFFF) | ((DWORD)alpha << 24); }

// ---------------------------------------------------------------- drawing

void* RoundPath(float x, float y, float w, float h, float r) {
    void* p = NULL;
    gp.CreatePath(0, &p);
    float d = r * 2;
    gp.AddPathArc(p, x, y, d, d, 180, 90);
    gp.AddPathArc(p, x + w - d, y, d, d, 270, 90);
    gp.AddPathArc(p, x + w - d, y + h - d, d, d, 0, 90);
    gp.AddPathArc(p, x, y + h - d, d, d, 90, 90);
    gp.ClosePathFigure(p);
    return p;
}

void FillRound(void* g, DWORD color, float x, float y, float w, float h, float r) {
    void* brush = NULL; gp.CreateSolidFill(color, &brush);
    void* path = RoundPath(x, y, w, h, r);
    gp.FillPath(g, brush, path);
    gp.DeletePath(path); gp.DeleteBrush(brush);
}

void StrokeRound(void* g, DWORD color, float width, float x, float y, float w, float h, float r) {
    void* pen = NULL; gp.CreatePen1(color, width, 2 /* UnitPixel */, &pen);
    void* path = RoundPath(x, y, w, h, r);
    gp.DrawPath(g, pen, path);
    gp.DeletePath(path); gp.DeletePen(pen);
}

void Text(void* g, const wchar_t* text, const wchar_t* family, float size, int style, DWORD color,
          float x, float y, float w, float h, int align /* 0 near, 1 center */) {
    void* fam = NULL; void* font = NULL; void* fmt = NULL; void* brush = NULL;
    if (gp.CreateFontFamilyFromName(family, NULL, &fam) != 0) gp.CreateFontFamilyFromName(L"Segoe UI", NULL, &fam);
    gp.CreateFont(fam, size, style, 2 /* UnitPixel */, &font);
    gp.CreateStringFormat(0, 0, &fmt);
    gp.SetStringFormatAlign(fmt, align);
    gp.SetStringFormatLineAlign(fmt, 1);
    gp.SetStringFormatTrimming(fmt, 3 /* EllipsisCharacter */);
    gp.SetStringFormatFlags(fmt, 0x1000 /* NoWrap */);
    gp.CreateSolidFill(color, &brush);
    RectFX rc = { x, y, w, h };
    gp.DrawString(g, text, -1, font, &rc, fmt, brush);
    gp.DeleteBrush(brush); gp.DeleteStringFormat(fmt); gp.DeleteFont(font); gp.DeleteFontFamily(fam);
}

void Paint(HWND hWnd, HDC hdc) {
    RECT rc; GetClientRect(hWnd, &rc);
    int W = rc.right, H = rc.bottom;
    HDC mem = CreateCompatibleDC(hdc);
    HBITMAP bmp = CreateCompatibleBitmap(hdc, W, H);
    HGDIOBJ old = SelectObject(mem, bmp);

    if (!g_gdiplus) {
        // minimal fallback without GDI+
        HBRUSH b = CreateSolidBrush(RGB((C.bg >> 16) & 0xFF, (C.bg >> 8) & 0xFF, C.bg & 0xFF));
        FillRect(mem, &rc, b); DeleteObject(b);
        SetBkMode(mem, TRANSPARENT);
        SetTextColor(mem, RGB((C.ink >> 16) & 0xFF, (C.ink >> 8) & 0xFF, C.ink & 0xFF));
        DrawTextW(mem, g_szGameName, -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
    } else {
        void* g = NULL;
        gp.CreateFromHDC(mem, &g);
        gp.SetSmoothingMode(g, 4 /* AntiAlias */);
        gp.SetPixelOffsetMode(g, 4 /* Half */);
        gp.SetTextRenderingHint(g, 5 /* ClearTypeGridFit */);
        gp.SetInterpolationMode(g, 7 /* HighQualityBicubic */);

        float fw = (float)W, fh = (float)H;
        // canvas + hairline border (the window's own corners are rounded by Windows)
        void* bg = NULL; gp.CreateSolidFill(C.bg, &bg);
        void* full = RoundPath(-1, -1, fw + 2, fh + 2, 0.5f);
        gp.FillPath(g, bg, full); gp.DeletePath(full); gp.DeleteBrush(bg);
        StrokeRound(g, WithAlpha(C.line, 200), 1.0f, 0.5f, 0.5f, fw - 1, fh - 1, SF(12));

        float pad = SF(20);
        // eyebrow + live dot
        Text(g, L"NOW PLAYING", L"Segoe UI Semibold", SF(10.5f), 0, C.muted, pad, SF(16), fw - pad * 2, SF(18), 0);
        void* dot = NULL; gp.CreateSolidFill(C.accent, &dot);
        gp.FillEllipse(g, dot, fw - pad - SF(9), SF(20), SF(9), SF(9));
        gp.DeleteBrush(dot);

        // icon (or a letter tile), with a hairline frame
        float is = SF(92), ix = (fw - is) / 2, iy = SF(50), ir = SF(24);
        void* clip = RoundPath(ix, iy, is, is, ir);
        if (g_icon) {
            gp.SetClipPath(g, clip, 0);
            gp.DrawImageRect(g, g_icon, ix, iy, is, is);
            gp.ResetClip(g);
        } else {
            static const DWORD tiles[] = { 0xFF7C5CFF, 0xFFE0654F, 0xFF2E9E8F, 0xFFD9A441, 0xFF4F7FE0, 0xFFC0549A, 0xFF5E9E4F, 0xFF8A6FDB };
            unsigned hash = 0;
            for (const wchar_t* p = g_szGameName; *p; p++) hash = hash * 31 + *p;
            void* tile = NULL; gp.CreateSolidFill(tiles[hash % 8], &tile);
            gp.FillPath(g, tile, clip); gp.DeleteBrush(tile);
            wchar_t letter[2] = { g_szGameName[0] ? g_szGameName[0] : L'?', 0 };
            if (letter[0] >= L'a' && letter[0] <= L'z') letter[0] -= 32;
            Text(g, letter, L"Segoe UI", SF(40), 1 /* Bold */, 0xFFFFFFFF, ix, iy, is, is, 1);
        }
        gp.DeletePath(clip);
        StrokeRound(g, WithAlpha(C.ink, 40), 1.0f, ix - SF(4), iy - SF(4), is + SF(8), is + SF(8), ir + SF(4));

        // title + elapsed time
        Text(g, g_szGameName, L"Segoe UI", SF(20), 1 /* Bold */, C.ink, pad, SF(154), fw - pad * 2, SF(30), 1);
        ULONGLONG secs = (GetTickCount64() - g_started) / 1000;
        wchar_t sub[64];
        if (secs >= 3600) wsprintfW(sub, L"Playing \x00B7 %d:%02d:%02d", (int)(secs / 3600), (int)(secs / 60 % 60), (int)(secs % 60));
        else wsprintfW(sub, L"Playing \x00B7 %d:%02d", (int)(secs / 60), (int)(secs % 60));
        Text(g, sub, L"Segoe UI", SF(13), 0, C.muted, pad, SF(184), fw - pad * 2, SF(20), 1);

        // buttons: solid "Close" and outlined "Close & delete"
        float bh = SF(38), by = fh - pad - bh, gap = SF(8), bw = (fw - pad * 2 - gap) / 2;
        float r = bh / 2;
        SetRect(&g_btnClose, (int)pad, (int)by, (int)(pad + bw), (int)(by + bh));
        SetRect(&g_btnDelete, (int)(pad + bw + gap), (int)by, (int)(pad + bw * 2 + gap), (int)(by + bh));

        DWORD closeFill = g_hover == 1 ? Mix(C.btn, 0xFFFFFFFF, g_pressed == 1 ? 10 : 40) : C.btn;
        FillRound(g, closeFill, pad, by, bw, bh, r);
        Text(g, L"Close", L"Segoe UI Semibold", SF(14), 0, C.btnInk, pad, by, bw, bh, 1);

        float dx = pad + bw + gap;
        if (g_hover == 2) {
            FillRound(g, C.danger, dx, by, bw, bh, r);
            Text(g, L"Close & delete", L"Segoe UI Semibold", SF(14), 0, C.bg, dx, by, bw, bh, 1);
        } else {
            StrokeRound(g, WithAlpha(C.danger, 150), SF(1), dx + 0.5f, by + 0.5f, bw - 1, bh - 1, r);
            Text(g, L"Close & delete", L"Segoe UI Semibold", SF(14), 0, C.danger, dx, by, bw, bh, 1);
        }

        gp.DeleteGraphics(g);
    }

    BitBlt(hdc, 0, 0, W, H, mem, 0, 0, SRCCOPY);
    SelectObject(mem, old);
    DeleteObject(bmp);
    DeleteDC(mem);
}

// ---------------------------------------------------------------- placement

int CountRunnerWindows() {
    int n = 0;
    HWND h = NULL;
    while ((h = FindWindowExW(NULL, h, L"DQCTray", NULL)) != NULL) n++;
    return n;
}

// Bottom-right of the work area, cascading a little per open game window.
void MoveOnScreen(HWND hWnd, int index) {
    RECT rc;
    if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &rc, 0)) return;
    int size = S(WIN_SIZE), step = S(28) * (index % 6);
    SetWindowPos(hWnd, NULL, rc.right - size - S(24) - step, rc.bottom - size - S(24) - step, 0, 0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void ToggleWindow(HWND hWnd) {
    if (IsWindowVisible(hWnd)) {
        ShowWindow(hWnd, SW_HIDE);
    } else {
        MoveOnScreen(hWnd, 0);
        ShowWindow(hWnd, SW_SHOW);
        ShowWindow(hWnd, SW_RESTORE);
        SetForegroundWindow(hWnd);
    }
}

int HitButton(int x, int y) {
    POINT pt = { x, y };
    if (PtInRect(&g_btnClose, pt)) return 1;
    if (PtInRect(&g_btnDelete, pt)) return 2;
    return 0;
}

void Finish(HWND hWnd, int code) {
    g_exitCode = code;
    DestroyWindow(hWnd);
}

// ---------------------------------------------------------------- window procedure

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_CREATE:
        nid.cbSize = sizeof(NOTIFYICONDATAW);
        nid.hWnd = hWnd;
        nid.uID = 1;
        nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        nid.uCallbackMessage = WM_TRAY_MESSAGE;
        nid.hIcon = LoadIcon(NULL, IDI_APPLICATION);
        lstrcpynW(nid.szTip, g_szGameName, 128);
        if (!g_hidden) {
            f_Shell_NotifyIconW(NIM_ADD, &nid);
            g_iconShown = TRUE;
        }
        SetTimer(hWnd, TIMER_TICK, 1000, NULL);
        break;

    case WM_TIMER:
        if (IsWindowVisible(hWnd)) InvalidateRect(hWnd, NULL, FALSE);
        break;

    case WM_ERASEBKGND:
        return 1;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hWnd, &ps);
        Paint(hWnd, hdc);
        EndPaint(hWnd, &ps);
    } break;

    // the whole card drags like a title bar, except the buttons
    case WM_NCHITTEST: {
        LRESULT hit = DefWindowProcW(hWnd, message, wParam, lParam);
        if (hit == HTCLIENT) {
            POINT pt = { (short)LOWORD(lParam), (short)HIWORD(lParam) };
            ScreenToClient(hWnd, &pt);
            if (!HitButton(pt.x, pt.y)) return HTCAPTION;
        }
        return hit;
    }

    case WM_NCLBUTTONDBLCLK:
        return 0; // no maximize on double-click

    case WM_MOUSEMOVE: {
        int hover = HitButton((short)LOWORD(lParam), (short)HIWORD(lParam));
        if (!g_tracking) {
            TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE, hWnd, 0 };
            TrackMouseEvent(&tme);
            g_tracking = TRUE;
        }
        if (hover != g_hover) { g_hover = hover; InvalidateRect(hWnd, NULL, FALSE); }
    } break;

    case WM_MOUSELEAVE:
        g_tracking = FALSE;
        if (g_hover) { g_hover = 0; InvalidateRect(hWnd, NULL, FALSE); }
        break;

    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT && g_hover) {
            SetCursor(LoadCursor(NULL, IDC_HAND));
            return TRUE;
        }
        return DefWindowProcW(hWnd, message, wParam, lParam);

    case WM_LBUTTONDOWN:
        g_pressed = HitButton((short)LOWORD(lParam), (short)HIWORD(lParam));
        if (g_pressed) { SetCapture(hWnd); InvalidateRect(hWnd, NULL, FALSE); }
        break;

    case WM_LBUTTONUP: {
        int released = HitButton((short)LOWORD(lParam), (short)HIWORD(lParam));
        int pressed = g_pressed;
        g_pressed = 0;
        ReleaseCapture();
        InvalidateRect(hWnd, NULL, FALSE);
        if (pressed && pressed == released) Finish(hWnd, pressed == 2 ? EXIT_DELETE : EXIT_CLOSED);
    } break;

    case WM_TRAY_MESSAGE:
        if (lParam == WM_RBUTTONUP) {
            POINT cur; GetCursorPos(&cur);
            HMENU hMenu = CreatePopupMenu();
            InsertMenuW(hMenu, 0, MF_BYPOSITION | MF_STRING, ID_TRAY_TOGGLE, IsWindowVisible(hWnd) ? L"Hide" : L"Show");
            InsertMenuW(hMenu, 2, MF_SEPARATOR, 0, NULL);
            InsertMenuW(hMenu, 3, MF_BYPOSITION | MF_STRING, ID_TRAY_EXIT, L"Close");
            SetForegroundWindow(hWnd);
            TrackPopupMenu(hMenu, TPM_BOTTOMALIGN | TPM_LEFTALIGN, cur.x, cur.y, 0, hWnd, NULL);
            DestroyMenu(hMenu);
        }
        else if (lParam == WM_LBUTTONDBLCLK) ToggleWindow(hWnd);
        break;

    case WM_DQC_HIDE:
        ShowWindow(hWnd, SW_HIDE);
        if (g_iconShown) { f_Shell_NotifyIconW(NIM_DELETE, &nid); g_iconShown = FALSE; }
        break;

    case WM_DQC_SHOW:
        if (!g_iconShown) { f_Shell_NotifyIconW(NIM_ADD, &nid); g_iconShown = TRUE; }
        MoveOnScreen(hWnd, (int)wParam);
        ShowWindow(hWnd, SW_SHOWNOACTIVATE);
        break;

    case WM_COMMAND:
        if (LOWORD(wParam) == ID_TRAY_EXIT) Finish(hWnd, EXIT_CLOSED);
        if (LOWORD(wParam) == ID_TRAY_TOGGLE) ToggleWindow(hWnd);
        break;

    case WM_DESTROY:
        KillTimer(hWnd, TIMER_TICK);
        if (g_iconShown) f_Shell_NotifyIconW(NIM_DELETE, &nid);
        if (g_icon) { gp.DisposeImage(g_icon); g_icon = NULL; }
        PostQuitMessage(g_exitCode);
        break;

    default: return DefWindowProcW(hWnd, message, wParam, lParam);
    }
    return 0;
}

// ---------------------------------------------------------------- entry point

extern "C" void mainEntryPoint() {
    HINSTANCE hInst = GetModuleHandleW(NULL);
    HMODULE hShell32 = LoadLibraryW(L"shell32.dll");
    HMODULE hUser32 = LoadLibraryW(L"user32.dll");
    HMODULE hDwm = LoadLibraryW(L"dwmapi.dll");
    f_Shell_NotifyIconW = (P_Shell_NotifyIconW)GetProcAddress(hShell32, "Shell_NotifyIconW");

    // crisp on high-DPI screens
    P_SetProcessDPIAware setDpiAware = (P_SetProcessDPIAware)GetProcAddress(hUser32, "SetProcessDPIAware");
    if (setDpiAware) setDpiAware();
    HDC screen = GetDC(NULL);
    g_dpi = GetDeviceCaps(screen, LOGPIXELSX);
    ReleaseDC(NULL, screen);
    if (g_dpi < 96) g_dpi = 96;

    LPWSTR cmd = GetCommandLineW();
    g_hidden = FindStringW(cmd, L"--hidden") != NULL;
    g_show = FindStringW(cmd, L"--show") != NULL;
    GetArg(cmd, L"--title", g_szGameName, 256);
    wchar_t colors[160];
    if (GetArg(cmd, L"--colors", colors, 160)) ParseColors(colors);

    g_gdiplus = LoadGdiPlus();
    if (g_gdiplus && GetArg(cmd, L"--icon", g_szIconPath, MAX_PATH)) {
        if (gp.LoadImageFromFile(g_szIconPath, &g_icon) != 0) g_icon = NULL;
    }
    g_started = GetTickCount64();

    WNDCLASSW wc = { 0 };
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.lpszClassName = L"DQCTray";   // Questly finds game windows by this class name
    wc.hbrBackground = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    int size = S(WIN_SIZE);
    int others = CountRunnerWindows();
    // Parked: just beyond the bottom-right corner of the whole virtual desktop
    int x = GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN) + 64;
    int y = GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN) + 64;

    HWND hWnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, g_szGameName,
        WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX, x, y, size, size, NULL, NULL, hInst, NULL);

    // Rounded corners: Windows 11 does it natively; older Windows gets a region
    int round = 2; // DWMWCP_ROUND
    P_DwmSetWindowAttribute dwmSet = hDwm ? (P_DwmSetWindowAttribute)GetProcAddress(hDwm, "DwmSetWindowAttribute") : NULL;
    if (!dwmSet || dwmSet(hWnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &round, sizeof(round)) != S_OK) {
        SetWindowRgn(hWnd, CreateRoundRectRgn(0, 0, size + 1, size + 1, S(24), S(24)), TRUE);
    }

    if (g_show) MoveOnScreen(hWnd, others);
    // SW_SHOWNOACTIVATE: never steal focus from whatever you're doing
    if (!g_hidden) ShowWindow(hWnd, SW_SHOWNOACTIVATE);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ExitProcess((UINT)g_exitCode);
}
