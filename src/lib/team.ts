import type { AppRole } from "@/lib/auth";

/**
 * QUIÉN PUEDE DAR QUÉ ROL, Y CÓMO ENTRA ALGUIEN AL SISTEMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA ESCALADA QUE HABÍA
 *
 * Dar de alta a alguien exigía rol de administrador y aceptaba CUALQUIER rol,
 * incluido `owner`, con una contraseña que elegía el propio administrador. Es
 * decir: cualquier administrador podía crear una cuenta de propietario con una
 * clave suya y entrar con ella. El sistema impedía que se cambiara su propio
 * rol —y esa guarda daba la impresión de que el asunto estaba cubierto—, pero
 * el camino de al lado estaba abierto.
 *
 * La regla, que es la de siempre en control de accesos: NADIE OTORGA UN ROL
 * POR ENCIMA DEL SUYO. Un gerente no nombra administradores y un administrador
 * no nombra propietarios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LA CONTRASEÑA QUE NUNCA DEBIÓ VIAJAR
 *
 * La otra mitad del problema es que la contraseña inicial la inventaba el
 * administrador y se la pasaba a la persona por WhatsApp. Eso significa que
 * alguien más conoce la clave con la que se firman cierres de caja y anulan
 * facturas —y la bitácora, que es lo que responde «¿quién hizo esto?», deja de
 * significar nada—. Por eso ahora se invita: la persona recibe un correo y
 * pone su propia contraseña, que nadie más ha visto nunca.
 */

/** Los roles que se pueden asignar desde la pantalla de equipo. */
export const ASSIGNABLE_ROLES: AppRole[] = [
  "owner", "admin", "manager", "operations", "cashier", "seller", "partner",
];

const RANK: Record<string, number> = {
  superadmin: 100, owner: 90, admin: 80, manager: 60, operations: 40, cashier: 40, seller: 20, partner: 10,
};

/**
 * Los roles que este rol puede otorgar: el suyo y los de abajo.
 *
 * Incluye el propio para que un propietario pueda nombrar a otro propietario
 * —una empresa con un solo dueño y sin segundo administrador es un problema de
 * continuidad, no una medida de seguridad.
 */
export function assignableRoles(actor: string): AppRole[] {
  const rank = RANK[actor] ?? 0;
  return ASSIGNABLE_ROLES.filter((role) => (RANK[role] ?? 0) <= rank);
}

export function canAssign(actor: string, target: string): boolean {
  return assignableRoles(actor).includes(target as AppRole);
}

export interface RoleDecision {
  ok: boolean;
  role?: AppRole;
  message?: string;
  status?: number;
}

/**
 * ¿Puede este rol otorgar ese otro? Decisión pura, para que la misma respuesta
 * valga en el alta, en la invitación y en el cambio de rol.
 */
export function roleDecision(actor: string, target: string | undefined | null): RoleDecision {
  const role = (target || "").trim();
  if (!role) return { ok: false, message: "Falta el rol", status: 400 };
  if (!ASSIGNABLE_ROLES.includes(role as AppRole)) {
    return { ok: false, message: `Rol no válido: ${role}`, status: 400 };
  }
  if (!canAssign(actor, role)) {
    return {
      ok: false,
      status: 403,
      message: `No puedes otorgar el rol «${role}»: está por encima del tuyo. Pídeselo a quien lo tenga.`,
    };
  }
  return { ok: true, role: role as AppRole };
}

/* -------------------------------------------------------- el correo */

/** Normaliza como lo guarda Supabase Auth: sin espacios y en minúsculas. */
export function normalizeEmail(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

/**
 * Validación deliberadamente simple.
 *
 * No intenta decidir si un correo EXISTE —eso solo lo dice el envío—, solo
 * descarta lo que no puede ser una dirección. Una expresión estricta rechazaría
 * direcciones válidas y raras, y el precio de equivocarse en ese lado es dejar
 * a alguien fuera del sistema sin saber por qué.
 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/* ------------------------------------------------- estado de la cuenta */

export type MemberState = "active" | "invited" | "inactive" | "suspended";

/**
 * Cómo se le enseña al administrador el estado de cada cuenta.
 *
 * `pending` en la base significa «invitada y sin aceptar». En la pantalla se
 * dice «invitado», que es lo que el administrador necesita saber para decidir
 * si reenvía la invitación o llama por teléfono.
 */
export function memberState(status: string | null | undefined): MemberState {
  switch (status) {
    case "pending": return "invited";
    case "inactive": return "inactive";
    case "suspended": return "suspended";
    default: return "active";
  }
}

export const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  active: "Activo",
  invited: "Invitado",
  inactive: "Inactivo",
  suspended: "Suspendido",
};

/* --------------------------------------------------- la contraseña nueva */

/** Mínimo de la casa. Coincide con el que ya exigía el alta manual. */
export const MIN_PASSWORD = 8;

/**
 * Las peores contraseñas posibles, escritas tal cual por quien tiene prisa.
 *
 * No es una lista de seguridad —para eso están el largo y el gestor de
 * contraseñas de cada quien—: es el puñado que aparece cuando alguien quiere
 * salir del formulario, y son precisamente las que se prueban primero.
 */
const OBVIAS = [
  "12345678", "123456789", "1234567890", "password", "passw0rd", "contrasena",
  "contraseña", "qwertyui", "abc12345", "11111111", "iloveyou", "admin123",
];

/**
 * Qué le falta a esta contraseña, en una frase que se pueda arreglar.
 *
 * Devuelve `null` cuando está bien. Es pura porque la misma regla la aplican la
 * pantalla —para avisar mientras se escribe— y el servidor, y dos versiones de
 * «contraseña válida» acaban en un formulario que acepta lo que la API rechaza.
 */
export function passwordIssue(password: string, confirmation?: string): string | null {
  if (!password) return "Escribe una contraseña";
  if (password.length < MIN_PASSWORD) {
    return `La contraseña necesita al menos ${MIN_PASSWORD} caracteres`;
  }
  if (password.trim().length < MIN_PASSWORD) {
    // Espacios al principio o al final: se copian sin verse y luego no entra.
    return "La contraseña no puede ser casi toda espacios";
  }
  if (OBVIAS.includes(password.toLowerCase())) {
    return "Esa contraseña es de las primeras que alguien probaría. Usa otra.";
  }
  if (confirmation !== undefined && password !== confirmation) {
    return "Las dos contraseñas no coinciden";
  }
  return null;
}

/* ------------------------------------------- el regreso desde el correo */

/**
 * A dónde se puede volver después de canjear un enlace de correo.
 *
 * Solo rutas de ESTE sistema. Sin esta comprobación, un enlace con
 * `next=https://sitio-ajeno` convierte el dominio propio en trampolín: la
 * persona ve la dirección de su sistema en el correo, pulsa, y acaba en otro
 * sitio con la sesión recién creada.
 *
 * Las tres formas de escaparse, y por qué no basta con exigir que empiece por
 * barra:
 *
 *  · `//otro.com` — el navegador lo lee como «mismo protocolo, otro dominio».
 *  · `/\otro.com` — la barra invertida cuenta como barra al resolver la URL.
 *    Comprobado: `new URL("/\\otro.com", "https://mi.app")` devuelve
 *    `https://otro.com/`. Es el caso que se cuela cuando solo se mira el
 *    primer carácter.
 *  · Un espacio, tabulador o salto delante, que el navegador recorta antes de
 *    interpretar el resto.
 */
export function safeNextPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/")) return "/dashboard";
  // El segundo carácter decide: barra o barra invertida significan «otro
  // dominio», con o sin protocolo.
  if (value.length > 1 && (value[1] === "/" || value[1] === "\\")) return "/dashboard";
  // Y nada de control: un tabulador o un salto de línea se recortan al
  // interpretar la URL y cambian lo que queda.
  if (/[\u0000-\u001F\u007F]/.test(value)) return "/dashboard";
  return value;
}
