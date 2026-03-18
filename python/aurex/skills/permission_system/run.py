"""
Permission System - Controle de acesso e confirmação interativa.

Resolve o gap crítico de segurança: o agent pode executar qualquer
ação sem pedir permissão. Este sistema implementa:

1. Classificação automática de risco por ação
2. Whitelist/blacklist configurável
3. Confirmação interativa para ações perigosas
4. Modos de operação: auto_approve, ask_always, smart
5. Audit log de todas as decisões

Regras de risco:
- SAFE: leitura de arquivos, listagem, busca
- LOW: edição de arquivos, criação de arquivos
- MEDIUM: execução de comandos, instalação de pacotes
- HIGH: deletar arquivos, git push, modificar configs
- CRITICAL: force push, drop tables, rm -rf, format disk
"""

import re
import json
import time
import logging
from typing import Any, Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class RiskLevel(str, Enum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class PermissionRule:
    """Regra de permissão para um padrão de ação."""
    pattern: str  # Regex pattern para match de ação
    risk_level: RiskLevel
    auto_deny: bool = False  # Sempre negar (blacklist absoluta)
    auto_allow: bool = False  # Sempre permitir (whitelist)
    description: str = ""


# Regras padrão de classificação de risco
DEFAULT_RULES: list[PermissionRule] = [
    # CRITICAL - Sempre requer confirmação ou auto_deny
    PermissionRule(
        pattern=r"(rm\s+-rf\s+/|del\s+/f\s+/s\s+/q\s+[A-Za-z]:\\|rd\s+/s\s+/q\s+[A-Za-z]:\\|Remove-Item\s+-Recurse\s+-Force\s+[A-Za-z]:\\)",
        risk_level=RiskLevel.CRITICAL,
        auto_deny=True,
        description="Destructive deletion in root or drive",
    ),
    PermissionRule(
        pattern=r"(drop\s+database|drop\s+table|truncate\s+table)",
        risk_level=RiskLevel.CRITICAL,
        description="Operação destrutiva de banco de dados",
    ),
    PermissionRule(
        pattern=r"git\s+push\s+.*--force",
        risk_level=RiskLevel.CRITICAL,
        description="Force push pode sobrescrever trabalho de outros",
    ),
    PermissionRule(
        pattern=r"git\s+reset\s+--hard",
        risk_level=RiskLevel.CRITICAL,
        description="Hard reset descarta todas as alterações locais",
    ),
    PermissionRule(
        pattern=r"(format|mkfs|fdisk)",
        risk_level=RiskLevel.CRITICAL,
        auto_deny=True,
        description="Formatação de disco",
    ),
    PermissionRule(
        pattern=r"chmod\s+777",
        risk_level=RiskLevel.CRITICAL,
        description="Permissões totalmente abertas",
    ),

    # HIGH - Requer confirmação em modo smart
    PermissionRule(
        pattern=r"(delete_file|remove_file|unlink)",
        risk_level=RiskLevel.HIGH,
        description="Deletar arquivo",
    ),
    PermissionRule(
        pattern=r"git\s+push",
        risk_level=RiskLevel.HIGH,
        description="Push para repositório remoto",
    ),
    PermissionRule(
        pattern=r"git\s+branch\s+-[dD]",
        risk_level=RiskLevel.HIGH,
        description="Deletar branch git",
    ),
    PermissionRule(
        pattern=r"(npm\s+publish|pip\s+upload|cargo\s+publish)",
        risk_level=RiskLevel.HIGH,
        description="Publicar pacote",
    ),
    PermissionRule(
        pattern=r"(curl|wget)\s+.*\|\s*(bash|sh|python)",
        risk_level=RiskLevel.HIGH,
        description="Download e execução de script remoto",
    ),
    PermissionRule(
        pattern=r"(kill|killall|pkill)\s+",
        risk_level=RiskLevel.HIGH,
        description="Matar processo",
    ),

    PermissionRule(
        pattern=r"exec_command",
        risk_level=RiskLevel.HIGH,
        description="Execução de comando shell (sempre pede confirmação no modo padrão)",
    ),

    # MEDIUM - Permitido com log em modo smart
    PermissionRule(
        pattern=r"(npm\s+install|pip\s+install|apt\s+install)",
        risk_level=RiskLevel.MEDIUM,
        description="Instalação de pacote",
    ),
    PermissionRule(
        pattern=r"git\s+commit",
        risk_level=RiskLevel.MEDIUM,
        description="Criar commit",
    ),
    PermissionRule(
        pattern=r"(write_file|create_file)",
        risk_level=RiskLevel.MEDIUM,
        description="Criar novo arquivo (avaliado em diff pelo CLI)",
    ),

    # LOW - Permitido sem confirmação
    PermissionRule(
        pattern=r"edit_file",
        risk_level=RiskLevel.LOW,
        description="Editar arquivo existente (avaliado em diff pelo CLI)",
    ),
    PermissionRule(
        pattern=r"git\s+(status|diff|log|branch|stash)",
        risk_level=RiskLevel.LOW,
        auto_allow=True,
        description="Operação git de leitura",
    ),

    # SAFE - Sempre permitido
    PermissionRule(
        pattern=r"(read_file|list_files|search|grep|glob|fetch_url)",
        risk_level=RiskLevel.SAFE,
        auto_allow=True,
        description="Operação de leitura",
    ),
]


@dataclass
class AuditEntry:
    """Registro de auditoria de uma decisão de permissão."""
    timestamp: float
    action: str
    args: dict
    risk_level: str
    decision: str  # allowed, denied, user_confirmed, user_denied
    reason: str
    mode: str


class PermissionManager:
    """Gerenciador de permissões com classificação de risco e confirmação."""

    def __init__(
        self,
        mode: str = "smart",
        custom_rules: list[PermissionRule] | None = None,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
        ask_callback: Optional[Any] = None,
    ):
        self.mode = mode
        self.rules = (custom_rules or []) + DEFAULT_RULES
        self.whitelist = set(whitelist or [])
        self.blacklist = set(blacklist or [])
        self.audit_log: list[AuditEntry] = []
        self.session_approvals: dict[str, bool] = {}  # Cache de aprovações da sessão
        self.ask_callback = ask_callback

    def classify_risk(self, action: str, args: dict | None = None) -> tuple[RiskLevel, str]:
        """Classifica o nível de risco de uma ação."""
        # Monta string completa para matching
        full_action = action
        if args:
            full_action += " " + json.dumps(args, default=str)

        # Verifica blacklist primeiro
        for blocked in self.blacklist:
            if blocked in full_action:
                return RiskLevel.CRITICAL, f"Ação bloqueada pela blacklist: {blocked}"

        # Verifica whitelist
        for allowed in self.whitelist:
            if allowed in full_action:
                return RiskLevel.SAFE, f"Ação permitida pela whitelist: {allowed}"

        # Verifica regras
        for rule in self.rules:
            if re.search(rule.pattern, full_action, re.IGNORECASE):
                return rule.risk_level, rule.description

        # Default: MEDIUM para ações desconhecidas
        return RiskLevel.MEDIUM, "Ação não classificada - tratada como risco médio"

    async def check_permission(
        self,
        action: str,
        args: dict | None = None,
        skip_confirmation: bool = False,
    ) -> dict[str, Any]:
        """
        Verifica se uma ação é permitida.
        Retorna dict com allowed, risk_level, reason, requires_confirmation.
        """
        risk_level, reason = self.classify_risk(action, args)
        args = args or {}

        # Modo auto_approve: permite tudo exceto blacklist
        if self.mode == "auto_approve":
            # Ainda bloqueia CRITICAL com auto_deny
            for rule in self.rules:
                if rule.auto_deny and re.search(rule.pattern, action, re.IGNORECASE):
                    self._log(action, args, risk_level, "denied", reason, self.mode)
                    return {
                        "allowed": False,
                        "risk_level": risk_level.value,
                        "reason": f"BLOQUEADO: {reason}",
                        "requires_confirmation": False,
                    }
            self._log(action, args, risk_level, "allowed", reason, self.mode)
            return {
                "allowed": True,
                "risk_level": risk_level.value,
                "reason": reason,
                "requires_confirmation": False,
            }

        # Modo ask_always: pede confirmação para tudo
        if self.mode == "ask_always":
            if risk_level == RiskLevel.SAFE:
                self._log(action, args, risk_level, "allowed", reason, self.mode)
                return {
                    "allowed": True,
                    "risk_level": risk_level.value,
                    "reason": reason,
                    "requires_confirmation": False,
                }
            if skip_confirmation:
                self._log(action, args, risk_level, "allowed", "skip_confirmation", self.mode)
                return {
                    "allowed": True,
                    "risk_level": risk_level.value,
                    "reason": reason,
                    "requires_confirmation": True,
                }
            return await self._request_confirmation(action, args, risk_level, reason)

        # Modo smart (default): baseado no nível de risco
        if risk_level == RiskLevel.SAFE or risk_level == RiskLevel.LOW:
            self._log(action, args, risk_level, "allowed", reason, self.mode)
            return {
                "allowed": True,
                "risk_level": risk_level.value,
                "reason": reason,
                "requires_confirmation": False,
            }

        # Verifica auto_deny
        for rule in self.rules:
            if rule.auto_deny and re.search(rule.pattern, action, re.IGNORECASE):
                self._log(action, args, risk_level, "denied", reason, self.mode)
                return {
                    "allowed": False,
                    "risk_level": risk_level.value,
                    "reason": f"BLOQUEADO AUTOMATICAMENTE: {reason}",
                    "requires_confirmation": False,
                }

        # MEDIUM: permitir com log
        if risk_level == RiskLevel.MEDIUM:
            self._log(action, args, risk_level, "allowed", reason, self.mode)
            return {
                "allowed": True,
                "risk_level": risk_level.value,
                "reason": reason,
                "requires_confirmation": False,
            }

        # HIGH e CRITICAL: requer confirmação
        if skip_confirmation:
            # Verifica cache da sessão
            cache_key = f"{action}:{json.dumps(args, sort_keys=True, default=str)}"
            if cache_key in self.session_approvals:
                decision = "allowed" if self.session_approvals[cache_key] else "denied"
                self._log(action, args, risk_level, decision, "cached session approval", self.mode)
                return {
                    "allowed": self.session_approvals[cache_key],
                    "risk_level": risk_level.value,
                    "reason": f"Decisão cacheada da sessão: {reason}",
                    "requires_confirmation": False,
                }

        return await self._request_confirmation(action, args, risk_level, reason)

    async def _request_confirmation(
        self,
        action: str,
        args: dict,
        risk_level: RiskLevel,
        reason: str,
    ) -> dict[str, Any]:
        """Solicita confirmação interativa do usuário."""
        if self.ask_callback:
            try:
                response = await self.ask_callback(action, args, risk_level.value, reason)
                response = str(response).strip().lower()
            except Exception as e:
                logger.error(f"Error calling ask_callback: {e}")
                response = "n"
        else:
            response = "n"
            logger.warning(f"No ask_callback provided for interactive prompt. Defaulting to deny: {response}")

        cache_key = f"{action}:{json.dumps(args, sort_keys=True, default=str)}"

        if response in ("s", "sim", "y", "yes", "true"):
            self._log(action, args, risk_level, "user_confirmed", reason, self.mode)
            return {
                "allowed": True,
                "risk_level": risk_level.value,
                "reason": f"Aprovado pelo usuário: {reason}",
                "requires_confirmation": True,
            }
        elif response == "sempre":
            self.session_approvals[cache_key] = True
            self._log(action, args, risk_level, "user_always", reason, self.mode)
            return {
                "allowed": True,
                "risk_level": risk_level.value,
                "reason": f"Aprovado permanentemente nesta sessão: {reason}",
                "requires_confirmation": True,
            }
        elif response == "nunca":
            self.session_approvals[cache_key] = False
            self._log(action, args, risk_level, "user_never", reason, self.mode)
            return {
                "allowed": False,
                "risk_level": risk_level.value,
                "reason": f"Negado permanentemente nesta sessão: {reason}",
                "requires_confirmation": True,
            }
        else:
            self._log(action, args, risk_level, "user_denied", reason, self.mode)
            return {
                "allowed": False,
                "risk_level": risk_level.value,
                "reason": f"Negado pelo usuário: {reason}",
                "requires_confirmation": True,
            }

    def _log(
        self,
        action: str,
        args: dict,
        risk_level: RiskLevel,
        decision: str,
        reason: str,
        mode: str,
    ) -> None:
        """Registra decisão no audit log."""
        entry = AuditEntry(
            timestamp=time.time(),
            action=action,
            args=args,
            risk_level=risk_level.value,
            decision=decision,
            reason=reason,
            mode=mode,
        )
        self.audit_log.append(entry)
        logger.info(f"Permission: {decision} | {action} | {risk_level.value} | {reason}")

    def get_audit_log(self) -> list[dict]:
        """Retorna o log de auditoria."""
        return [
            {
                "timestamp": e.timestamp,
                "action": e.action,
                "risk_level": e.risk_level,
                "decision": e.decision,
                "reason": e.reason,
            }
            for e in self.audit_log
        ]


# Singleton global
_manager: Optional[PermissionManager] = None


def get_manager(mode: str = "smart", **kwargs) -> PermissionManager:
    """Obtém ou cria o PermissionManager singleton."""
    global _manager
    if _manager is None or _manager.mode != mode:
        _manager = PermissionManager(mode=mode, **kwargs)
    return _manager


async def run(params: dict[str, Any], tool_registry: Any = None) -> dict[str, Any]:
    """
    Entry point da skill de permissões.

    Verifica se uma ação é permitida baseado no nível de risco
    e no modo de permissão configurado.
    """
    action = params.get("action", "")
    if not action:
        return {"error": "action é obrigatório"}

    args = params.get("args", {})
    mode = params.get("mode", "smart")
    user_rules = params.get("user_rules", {})
    skip_confirmation = params.get("skip_confirmation", False)

    whitelist = user_rules.get("whitelist", [])
    blacklist = user_rules.get("blacklist", [])

    manager = get_manager(
        mode=mode,
        whitelist=whitelist,
        blacklist=blacklist,
    )

    result = await manager.check_permission(
        action=action,
        args=args,
        skip_confirmation=skip_confirmation,
    )

    return result
