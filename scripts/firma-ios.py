"""Configura la firma manual del target App (solo en el servidor de compilación).
Uso: python3 scripts/firma-ios.py <TEAM_ID> "<nombre del perfil>"
Se modifica solo el target App; los paquetes Swift de los plugins no se tocan."""
import re, sys
team, perfil = sys.argv[1], sys.argv[2]
ruta = 'ios/App/App.xcodeproj/project.pbxproj'
s = open(ruta, encoding='utf-8').read()
nuevo = ('CODE_SIGN_STYLE = Manual;\n\t\t\t\tDEVELOPMENT_TEAM = %s;\n'
         '\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "%s";\n'
         '\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";') % (team, perfil)
s, n = re.subn(r'CODE_SIGN_STYLE = Automatic;', nuevo, s)
if n == 0:
    sys.exit('No se encontró CODE_SIGN_STYLE en el proyecto iOS')
open(ruta, 'w', encoding='utf-8').write(s)
print(f'Firma manual configurada en {n} configuraciones del target App')
