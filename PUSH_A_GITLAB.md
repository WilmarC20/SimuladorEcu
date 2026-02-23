# Subir el código a GitLab (un solo paso manual)

El proyecto en GitLab está vacío y **no acepta el primer push** hasta que exista la rama por defecto. Eso solo se puede crear desde la web.

## 1. Crear la rama por defecto en GitLab (solo una vez)

1. Entra a: **https://gitlab.com/wilmarcaicedo/simuladorecu**
2. Donde dice "The repository for this project is empty", haz clic en **"Initialize repository with a README"**.
3. Deja el contenido por defecto y confirma. Con eso se crea la rama `main`.

## 2. Traer ese commit y subir todo tu código

En la terminal, desde la carpeta del proyecto:

```bash
cd /home/wilmarc/dashboard
git pull origin main --rebase
git push origin main
```

Si pide usuario/contraseña, en contraseña usa tu **token de GitLab** (el que tienes guardado).

---

Después de esto ya no necesitas este archivo; puedes borrarlo o ignorarlo.
