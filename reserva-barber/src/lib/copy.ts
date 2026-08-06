/**
 * User-facing copy — Spanish (es-AR), isolated from logic per frontend-standards.md.
 * All identifiers stay in English; only the string values are Spanish.
 */
export const COPY = {
  locations: {
    heading: 'Nuestras sucursales',
    empty: 'Todavía no hay sucursales cargadas.',
    error: 'No pudimos cargar las sucursales. Intentá de nuevo más tarde.',
    retry: 'Reintentar',
  },
  auth: {
    heading: 'Iniciar sesión',
    emailLabel: 'Email',
    passwordLabel: 'Contraseña',
    submit: 'Ingresar',
    submitting: 'Ingresando…',
    credentialsError: 'Email o contraseña incorrectos.',
    infrastructureError: 'No pudimos iniciar sesión. Intentá de nuevo más tarde.',
    logout: 'Cerrar sesión',
  },
} as const;
