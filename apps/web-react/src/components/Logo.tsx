import lockup from '@divertiflix/brand/assets/lockup.svg'
import logo from '@divertiflix/brand/assets/logo.svg'

/** Logo officiel à plat (marque + mot) : lisible en petit, sur fond sombre. */
export function Logo() {
  return <img className="logo" src={lockup} alt="Divertiflix" width={300} height={34} decoding="async" />
}

/** Logo complet (marque, mot chromé et signature) : connexion et écrans d'accueil. */
export function LogoFull({ width = 320 }: { width?: number }) {
  return <img className="logo-full" src={logo} alt="Divertiflix, stream without limits" width={width} height={Math.round(width * 0.66)} decoding="async" />
}
