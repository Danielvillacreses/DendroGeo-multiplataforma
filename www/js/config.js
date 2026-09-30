// Configuración de la nube (Supabase) del proyecto DendroGeo.
// La clave "anon" es pública por diseño: solo permite lo que autorizan las
// políticas de seguridad (RLS) de supabase/schema.sql. Nunca ponga aquí la service_role.
// Para usar otra base de datos, cambie estos valores o ingréselos en Ajustes de la app.
export const CONFIG = {
  SUPABASE_URL: 'https://chukrzupbfsecgdshljw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNodWtyenVwYmZzZWNnZHNobGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3OTkwNjAsImV4cCI6MjEwNjM3NTA2MH0.PeidvCWpFOw4z25zOKPGaQPkQqUuvuFk1qZxXqjlSg8',
};
