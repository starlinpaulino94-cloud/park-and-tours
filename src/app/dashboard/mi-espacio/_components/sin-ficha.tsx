import { EmptyState } from "@/components/tf/empty-state";

/**
 * «Tu cuenta no está vinculada a ninguna ficha de vendedor.»
 *
 * Es la tercera de las tres situaciones posibles —gerente que vende, vendedor
 * con ficha, cuenta sin ficha— y la única que antes no se distinguía: quien
 * entraba sin ficha veía las mismas pantallas, todas vacías, y no tenía forma
 * de saber si es que no había vendido nada o es que el sistema no sabía quién
 * era. Dos cosas muy distintas con la misma pinta.
 *
 * Dice además QUIÉN lo arregla, porque la persona que lee esto no puede
 * hacerlo por sí misma: hace falta rango de administración.
 */
export function SinFicha() {
  return (
    <EmptyState
      icon="UserRoundX"
      title="Tu cuenta todavía no está vinculada a una ficha de vendedor"
      description={
        "Por eso esta pantalla está vacía: el sistema no sabe cuáles de las ventas " +
        "de la empresa son tuyas. Pídele a un administrador que abra Vendedores, " +
        "busque tu ficha y use «Cuenta de acceso» —o el botón de crear cuenta e " +
        "invitar— para enlazarla. En cuanto lo haga, tus ventas y tu comisión " +
        "aparecen aquí sin que tengas que volver a entrar."
      }
    />
  );
}
