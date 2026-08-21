package com.operaciones.operaciones_android.model

enum class UserRole(val display: String) {
    CET("Comandante de Equipo de Trabajo"),
    CELL("Célula Operativa"),       // BD usa CELL (no CELULA)
    ADMIN("Administrador"),          // solo plataforma web
    CUT("Comandante de Unidad")      // solo plataforma web
}