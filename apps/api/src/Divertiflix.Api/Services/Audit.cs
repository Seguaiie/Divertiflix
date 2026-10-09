using Divertiflix.Domain;
using Divertiflix.Infrastructure;

namespace Divertiflix.Api.Services;

/// <summary>Journal d'audit des écritures sensibles. Enregistré avec le SaveChanges de l'appelant.</summary>
public sealed class Audit(DivertiflixDbContext db)
{
    public void Record(Guid? userId, string action, string target, string? detail = null) =>
        db.AuditLogs.Add(new AuditLog { UserId = userId, Action = action, Target = target, Detail = detail?.Length > 300 ? detail[..300] : detail });
}
