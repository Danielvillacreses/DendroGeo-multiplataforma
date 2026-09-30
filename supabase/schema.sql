-- =====================================================================
-- DendroGeo · Esquema de base de datos para Supabase (PostgreSQL + PostGIS)
-- Registro georreferenciado y monitoreo histórico de árboles
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo este archivo → Run.
-- Es idempotente en lo posible (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos de dominio
-- ---------------------------------------------------------------------
do $$ begin
  create type estado_sanitario as enum ('bueno','regular','malo','muerto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rol_proyecto as enum ('admin','tecnico','lector');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Función común: marca de tiempo del servidor + "última escritura gana"
-- La app envía modificado_cliente (hora del dispositivo al editar).
-- Si llega una versión más antigua que la guardada, se ignora.
-- updated_at (hora del servidor) es el cursor de sincronización.
-- ---------------------------------------------------------------------
create or replace function dg_sync_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.modificado_cliente < old.modificado_cliente then
    return null;               -- descarta la versión antigua (conflicto)
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Proyectos y miembros
-- ---------------------------------------------------------------------
create table if not exists proyectos (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  descripcion        text,
  factor_forma       numeric(4,3) not null default 0.5 check (factor_forma between 0.2 and 1),
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  modificado_cliente timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted            boolean not null default false
);

create table if not exists miembros_proyecto (
  proyecto_id uuid references proyectos(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  rol         rol_proyecto not null default 'tecnico',
  created_at  timestamptz not null default now(),
  primary key (proyecto_id, user_id)
);

-- ---------------------------------------------------------------------
-- Parcelas (unidades de muestreo) — polígono opcional
-- ---------------------------------------------------------------------
create table if not exists parcelas (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid not null references proyectos(id) on delete cascade,
  codigo             text not null,
  nombre             text,
  area_m2            numeric(12,2),
  geom               geometry(Polygon, 4326),
  created_by         uuid references auth.users(id) default auth.uid(),
  modificado_cliente timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted            boolean not null default false
);

-- ---------------------------------------------------------------------
-- Catálogo de especies (compartido por todos los usuarios)
-- densidad_madera en g/cm³ — se usa para biomasa (Chave et al. 2014)
-- ---------------------------------------------------------------------
create table if not exists especies (
  id                 uuid primary key default gen_random_uuid(),
  nombre_comun       text not null,
  nombre_cientifico  text,
  familia            text,
  densidad_madera    numeric(4,3) default 0.6,
  created_by         uuid references auth.users(id) default auth.uid(),
  modificado_cliente timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted            boolean not null default false
);

-- ---------------------------------------------------------------------
-- Árboles (individuo marcado; la posición es fija)
-- ---------------------------------------------------------------------
create table if not exists arboles (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid not null references proyectos(id) on delete cascade,
  parcela_id         uuid references parcelas(id) on delete set null,
  especie_id         uuid references especies(id) on delete set null,
  codigo             text not null,                 -- número de placa
  lat                double precision not null check (lat between -90 and 90),
  lon                double precision not null check (lon between -180 and 180),
  altitud_m          numeric(7,1),
  precision_m        numeric(7,2),                  -- error horizontal estimado (m)
  n_muestras_gps     integer,                       -- lecturas promediadas
  metodo_ubicacion   text default 'gps',            -- gps | mapa | manual
  geom               geometry(Point, 4326)
                     generated always as (st_setsrid(st_makepoint(lon, lat), 4326)) stored,
  observaciones      text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  modificado_cliente timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted            boolean not null default false,
  unique (proyecto_id, codigo)
);

-- ---------------------------------------------------------------------
-- Mediciones (serie histórica por árbol)
-- ---------------------------------------------------------------------
create table if not exists mediciones (
  id                  uuid primary key default gen_random_uuid(),
  arbol_id            uuid not null references arboles(id) on delete cascade,
  proyecto_id         uuid not null references proyectos(id) on delete cascade,
  fecha               date not null default current_date,
  cap_cm              numeric(7,2),                 -- circunferencia a 1,30 m
  dap_cm              numeric(7,2) not null check (dap_cm > 0 and dap_cm < 1000),
  altura_total_m      numeric(6,2),
  altura_comercial_m  numeric(6,2),
  copa_ns_m           numeric(6,2),
  copa_eo_m           numeric(6,2),
  estado_sanitario    estado_sanitario default 'bueno',
  vigor               smallint check (vigor between 1 and 3),   -- 1 alto · 2 medio · 3 bajo
  fenologia           text,                         -- vegetativo | floracion | fructificacion | defoliado
  danos               text[],                       -- plagas, enfermedades, daño mecánico…
  observaciones       text,
  tecnico             text,
  -- Variables derivadas (se recalculan siempre en el servidor)
  area_basal_m2       numeric(10,5) generated always as (pi() / 40000 * dap_cm * dap_cm) stored,
  area_copa_m2        numeric(10,2) generated always as
                        (pi() / 4 * power((coalesce(copa_ns_m, copa_eo_m) + coalesce(copa_eo_m, copa_ns_m)) / 2, 2)) stored,
  created_by          uuid references auth.users(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  modificado_cliente  timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted             boolean not null default false,
  constraint alturas_coherentes check (altura_comercial_m is null or altura_total_m is null or altura_comercial_m <= altura_total_m)
);

-- ---------------------------------------------------------------------
-- Fotos (archivo en Storage: bucket fotos-arboles)
-- ---------------------------------------------------------------------
create table if not exists fotos (
  id                 uuid primary key default gen_random_uuid(),
  arbol_id           uuid not null references arboles(id) on delete cascade,
  medicion_id        uuid references mediciones(id) on delete set null,
  proyecto_id        uuid not null references proyectos(id) on delete cascade,
  storage_path       text not null,               -- <proyecto_id>/<arbol_id>/<id>.jpg
  tipo               text default 'general',      -- general | fuste | copa | daño
  lat                double precision,
  lon                double precision,
  tomada_en          timestamptz default now(),
  created_by         uuid references auth.users(id) default auth.uid(),
  modificado_cliente timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted            boolean not null default false
);

-- ---------------------------------------------------------------------
-- Índices (espaciales y de sincronización)
-- ---------------------------------------------------------------------
create index if not exists arboles_geom_idx      on arboles using gist (geom);
create index if not exists parcelas_geom_idx     on parcelas using gist (geom);
create index if not exists arboles_upd_idx       on arboles (updated_at);
create index if not exists mediciones_upd_idx    on mediciones (updated_at);
create index if not exists mediciones_arbol_idx  on mediciones (arbol_id, fecha);
create index if not exists parcelas_upd_idx      on parcelas (updated_at);
create index if not exists proyectos_upd_idx     on proyectos (updated_at);
create index if not exists especies_upd_idx      on especies (updated_at);
create index if not exists fotos_upd_idx         on fotos (updated_at);

-- Disparadores de sincronización
do $$
declare t text;
begin
  foreach t in array array['proyectos','parcelas','especies','arboles','mediciones','fotos'] loop
    execute format('drop trigger if exists %I_sync on %I', t, t);
    execute format('create trigger %I_sync before insert or update on %I
                    for each row execute function dg_sync_stamp()', t, t);
  end loop;
end $$;

-- El creador de un proyecto queda como administrador
create or replace function dg_add_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into miembros_proyecto (proyecto_id, user_id, rol)
    values (new.id, new.created_by, 'admin')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists proyectos_add_creator on proyectos;
create trigger proyectos_add_creator after insert on proyectos
  for each row execute function dg_add_creator();

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------
create or replace function es_miembro(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros_proyecto m
                 where m.proyecto_id = p and m.user_id = auth.uid());
$$;

create or replace function puede_editar(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros_proyecto m
                 where m.proyecto_id = p and m.user_id = auth.uid()
                   and m.rol in ('admin','tecnico'));
$$;

alter table proyectos         enable row level security;
alter table miembros_proyecto enable row level security;
alter table parcelas          enable row level security;
alter table especies          enable row level security;
alter table arboles           enable row level security;
alter table mediciones        enable row level security;
alter table fotos             enable row level security;

-- Proyectos
drop policy if exists proy_sel on proyectos;
drop policy if exists proy_ins on proyectos;
drop policy if exists proy_upd on proyectos;
create policy proy_sel on proyectos for select using (es_miembro(id) or created_by = auth.uid());
create policy proy_ins on proyectos for insert with check (created_by = auth.uid());
create policy proy_upd on proyectos for update using (puede_editar(id) or created_by = auth.uid());

-- Miembros
drop policy if exists miem_sel on miembros_proyecto;
create policy miem_sel on miembros_proyecto for select using (es_miembro(proyecto_id));

-- Tablas hijas: leer si es miembro, escribir si es admin/técnico
do $$
declare t text;
begin
  foreach t in array array['parcelas','arboles','mediciones','fotos'] loop
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format('drop policy if exists %I_ins on %I', t, t);
    execute format('drop policy if exists %I_upd on %I', t, t);
    execute format('create policy %I_sel on %I for select using (es_miembro(proyecto_id))', t, t);
    execute format('create policy %I_ins on %I for insert with check (puede_editar(proyecto_id))', t, t);
    execute format('create policy %I_upd on %I for update using (puede_editar(proyecto_id))', t, t);
  end loop;
end $$;

-- Especies: catálogo común para usuarios autenticados
drop policy if exists esp_sel on especies;
drop policy if exists esp_ins on especies;
drop policy if exists esp_upd on especies;
create policy esp_sel on especies for select to authenticated using (true);
create policy esp_ins on especies for insert to authenticated with check (true);
-- catálogo colaborativo: cualquier usuario autenticado puede corregir una especie
create policy esp_upd on especies for update to authenticated using (true);

-- Invitar a un usuario registrado a un proyecto (solo administradores)
create or replace function invitar_miembro(p_proyecto uuid, p_email text, p_rol rol_proyecto default 'tecnico')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not exists (select 1 from miembros_proyecto
                 where proyecto_id = p_proyecto and user_id = auth.uid() and rol = 'admin') then
    raise exception 'Solo un administrador del proyecto puede invitar miembros';
  end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'No existe un usuario registrado con el correo %', p_email;
  end if;
  insert into miembros_proyecto (proyecto_id, user_id, rol) values (p_proyecto, uid, p_rol)
  on conflict (proyecto_id, user_id) do update set rol = excluded.rol;
end $$;

-- ---------------------------------------------------------------------
-- Almacenamiento de fotos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos-arboles', 'fotos-arboles', false)
on conflict (id) do nothing;

drop policy if exists fotos_obj_sel on storage.objects;
drop policy if exists fotos_obj_ins on storage.objects;
create policy fotos_obj_sel on storage.objects for select to authenticated
  using (bucket_id = 'fotos-arboles' and es_miembro(((storage.foldername(name))[1])::uuid));
create policy fotos_obj_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-arboles' and puede_editar(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- Vistas de análisis (respetan RLS con security_invoker)
-- ---------------------------------------------------------------------

-- Última medición vigente de cada árbol
create or replace view v_arbol_actual with (security_invoker = true) as
select distinct on (a.id)
  a.id, a.proyecto_id, a.parcela_id, a.codigo, a.lat, a.lon, a.precision_m,
  e.nombre_comun, e.nombre_cientifico, e.densidad_madera,
  m.fecha, m.dap_cm, m.altura_total_m, m.altura_comercial_m,
  m.area_basal_m2, m.area_copa_m2, m.estado_sanitario
from arboles a
left join especies e on e.id = a.especie_id
left join mediciones m on m.arbol_id = a.id and not m.deleted
where not a.deleted
order by a.id, m.fecha desc nulls last;

-- Incremento periódico anual (IPA) entre mediciones consecutivas
create or replace view v_incrementos with (security_invoker = true) as
select
  m.arbol_id, m.proyecto_id, m.fecha,
  m.dap_cm, m.altura_total_m,
  lag(m.fecha)  over w as fecha_anterior,
  lag(m.dap_cm) over w as dap_anterior,
  round(((m.dap_cm - lag(m.dap_cm) over w)
        / nullif((m.fecha - lag(m.fecha) over w) / 365.25, 0))::numeric, 2) as ipa_dap_cm_anio,
  round(((m.altura_total_m - lag(m.altura_total_m) over w)
        / nullif((m.fecha - lag(m.fecha) over w) / 365.25, 0))::numeric, 2) as ipa_altura_m_anio
from mediciones m
where not m.deleted
window w as (partition by m.arbol_id order by m.fecha);

-- Árboles dentro de un radio (para consultas desde la web)
create or replace function arboles_cerca(p_lat double precision, p_lon double precision, p_radio_m double precision)
returns setof arboles language sql stable as $$
  select * from arboles
  where not deleted
    and st_dwithin(geom::geography, st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, p_radio_m);
$$;

-- ---------------------------------------------------------------------
-- Permisos de la API (la seguridad fina la dan las políticas RLS de arriba)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on proyectos, parcelas, especies, arboles, mediciones, fotos to authenticated;
grant select on miembros_proyecto to authenticated;
grant select on v_arbol_actual, v_incrementos to authenticated;
grant execute on function es_miembro(uuid), puede_editar(uuid), arboles_cerca(double precision, double precision, double precision),
  invitar_miembro(uuid, text, rol_proyecto) to authenticated;
revoke all on proyectos, parcelas, especies, arboles, mediciones, fotos, miembros_proyecto from anon;

-- ---------------------------------------------------------------------
-- Especies de referencia (costa ecuatoriana; densidades aproximadas,
-- ajústelas con datos locales o la Global Wood Density Database)
-- ---------------------------------------------------------------------
insert into especies (id, nombre_comun, nombre_cientifico, familia, densidad_madera, created_by) values
  ('00000000-0000-4000-a000-000000000001','Teca','Tectona grandis','Lamiaceae',0.55,null),
  ('00000000-0000-4000-a000-000000000002','Balsa','Ochroma pyramidale','Malvaceae',0.16,null),
  ('00000000-0000-4000-a000-000000000003','Laurel','Cordia alliodora','Boraginaceae',0.48,null),
  ('00000000-0000-4000-a000-000000000004','Guayacán','Handroanthus chrysanthus','Bignoniaceae',0.92,null),
  ('00000000-0000-4000-a000-000000000005','Cacao','Theobroma cacao','Malvaceae',0.42,null),
  ('00000000-0000-4000-a000-000000000006','Samán','Samanea saman','Fabaceae',0.49,null),
  ('00000000-0000-4000-a000-000000000007','Ceibo','Ceiba trichistandra','Malvaceae',0.25,null),
  ('00000000-0000-4000-a000-000000000008','Fernán Sánchez','Triplaris cumingiana','Polygonaceae',0.55,null),
  ('00000000-0000-4000-a000-000000000009','Guachapelí','Albizia guachapele','Fabaceae',0.56,null),
  ('00000000-0000-4000-a000-000000000010','Pechiche','Vitex gigantea','Lamiaceae',0.60,null),
  ('00000000-0000-4000-a000-000000000011','Caoba','Swietenia macrophylla','Meliaceae',0.51,null),
  ('00000000-0000-4000-a000-000000000012','Cedro','Cedrela odorata','Meliaceae',0.41,null),
  ('00000000-0000-4000-a000-000000000013','Melina','Gmelina arborea','Lamiaceae',0.43,null),
  ('00000000-0000-4000-a000-000000000014','Algarrobo','Prosopis juliflora','Fabaceae',0.80,null),
  ('00000000-0000-4000-a000-000000000015','Moral fino','Maclura tinctoria','Moraceae',0.75,null)
on conflict (id) do nothing;
