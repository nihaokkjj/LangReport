import { createTheme } from "@mui/material/styles";

const sans =
  '"Inter", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const mono = '"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

export const theme = createTheme({
  cssVariables: true,
  spacing: 4,
  shape: { borderRadius: 12 },
  palette: {
    mode: "light",
    primary: { main: "#ff4f00", light: "#ff7a45", dark: "#d83f00", contrastText: "#201515" },
    secondary: { main: "#605d52", contrastText: "#fffefb" },
    success: { main: "#18794e" },
    warning: { main: "#8a5a00" },
    error: { main: "#b42318" },
    background: { default: "#fffefb", paper: "#fffefb" },
    text: { primary: "#201515", secondary: "#605d52", disabled: "#939084" },
    divider: "#c5c0b1",
    action: {
      hover: "#fff0e8",
      selected: "#fff0e8",
      disabled: "#939084",
      disabledBackground: "#f3ebe4",
    },
  },
  typography: {
    fontFamily: sans,
    fontSize: 16,
    button: { fontFamily: sans, fontSize: 16, fontWeight: 600, lineHeight: 1.5, textTransform: "none" },
    caption: { fontFamily: mono, fontSize: 12 },
    body1: { fontSize: 16, lineHeight: 1.6 },
    body2: { fontSize: 15, lineHeight: 1.5 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: "#fffefb", color: "#201515" },
        'button:focus-visible, a:focus-visible, [role="button"]:focus-visible': {
          outline: "2px solid #ff4f00",
          outlineOffset: 3,
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            transitionDuration: "0.01ms !important",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 12,
          paddingInline: 16,
          fontWeight: 600,
          whiteSpace: "normal",
          "&:disabled": { opacity: 1 },
          "&.MuiButton-containedPrimary:hover": { backgroundColor: "#ff7a45" },
          "&.MuiButton-containedPrimary:active": { backgroundColor: "#ff9873" },
        },
        outlined: { borderColor: "#c5c0b1", backgroundColor: "#fffefb" },
        text: { paddingInline: 8 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
          borderRadius: "50%",
          color: "#201515",
          backgroundColor: "#f8f4f0",
          "&:hover": { backgroundColor: "#fff0e8" },
          "&:disabled": { opacity: 1 },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 48,
          borderRadius: 6,
          backgroundColor: "#fffefb",
          "& fieldset": { borderColor: "#c5c0b1" },
          "&.Mui-focused": { outline: "2px solid #ff4f00", outlineOffset: 3 },
        },
        input: { padding: "12px 14px" },
      },
    },
    MuiTextField: { defaultProps: { variant: "outlined", fullWidth: true } },
    MuiFormLabel: { styleOverrides: { root: { color: "#605d52", fontWeight: 500 } } },
    MuiSelect: { defaultProps: { variant: "outlined" } },
    MuiDialog: {
      defaultProps: { fullWidth: true },
      styleOverrides: {
        paper: { borderRadius: 12, border: "1px solid #c5c0b1", boxShadow: "0 16px 48px rgba(32,21,21,.18)" },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiMenu: {
      styleOverrides: {
        paper: { border: "1px solid #c5c0b1", borderRadius: 12, boxShadow: "0 4px 16px rgba(32,21,21,.09)" },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: 15,
          alignItems: "center",
          "&.MuiAlert-standardError": { color: "#201515", backgroundColor: "#fdecea" },
          "&.MuiAlert-standardSuccess": { color: "#18794e", backgroundColor: "#e8f6ef" },
          "&.MuiAlert-standardWarning": { color: "#201515", backgroundColor: "#fff5d8" },
          "&.MuiAlert-standardInfo": { color: "#201515", backgroundColor: "#fff0e8" },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 9999, fontFamily: mono, fontSize: 12 } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
  },
});
