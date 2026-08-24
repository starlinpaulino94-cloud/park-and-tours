# Park and Tours

Plataforma Next.js para gestión turística con Supabase/Postgres como backend de datos y autenticación.

## Desarrollo

```bash
npm install
npm run dev
```

## Verificación

```bash
npm run check-types-errors
npm test
npm run build
```

## Entorno

Usa `.env.example` como referencia. Las variables reales deben vivir en `.env.local` o en el proveedor de despliegue.

Variables principales:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_USE_RLS=true`
- `NEXT_PUBLIC_APP_URL`
