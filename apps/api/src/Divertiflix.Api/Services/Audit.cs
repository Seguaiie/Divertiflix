using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;

namespace Divertiflix.Api.Services;

/// <summary>Journal d'audit des écritures sensibles. Enregistré avec le SaveChanges de l'appelant.</summary>
public sealed class Audit(DivertiflixDbContext db)
{
    // Les longueurs sont celles des colonnes : un courriel long ne doit jamais faire échouer l'action qu'on journalise.
    public void Record(Guid? userId, string action, string target, string? detail = null) =>
        db.AuditLogs.Add(new AuditLog { UserId = userId, Action = action, Target = target.Truncate(200), Detail = detail?.Truncate(300) });
}
