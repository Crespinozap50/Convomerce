# Panel administrativo

Frontend React + TypeScript construido con Vite. Consume la API NestJS mediante
cookies `HttpOnly`; no guarda tokens de sesión en JavaScript ni localStorage.

## Iniciar

Con PostgreSQL, Redis y el backend ya ejecutándose:

```bash
cd frontend
npm install
npm run dev
```

Abrir <http://localhost:5173>. Debe utilizarse `localhost`, no `127.0.0.1`,
porque el backend permite únicamente el origen configurado en
`FRONTEND_ORIGIN=http://localhost:5173`.

## Funciones actuales

- Login y restauración de sesión.
- Cambio obligatorio de contraseña temporal.
- Cierre de sesión.
- Selector de tenant para usuarios con membresías.
- Listado de miembros y resumen de roles.
- Invitación local de usuarios.
- Cambio de rol, deshabilitación y reactivación.
- Diseño adaptable para escritorio y móvil.

En desarrollo, el token de invitación se muestra para poder completar el flujo
sin proveedor de correo. En producción la API no lo devuelve.

## Compilar

```bash
npm run build
```

La URL de API puede cambiarse con `VITE_API_URL`; el valor predeterminado es
`http://localhost:3000`.
