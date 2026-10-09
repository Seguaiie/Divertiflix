using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;

namespace Divertiflix.Api.Support;

public static class Problems
{
    /// <summary>
    /// Erreur au format RFC 9457 (problem+json). La propriété « error » reprend le message pour rester
    /// compatible avec les clients React et Angular, qui lisent déjà { error: "..." }.
    /// </summary>
    public static ObjectResult Err(this ControllerBase c, int status, string message)
    {
        var pd = new ProblemDetails { Status = status, Title = ((HttpStatusCode)status).ToString(), Detail = message, Instance = c.Request.Path };
        pd.Extensions["error"] = message;
        return new ObjectResult(pd) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

public static class ClaimsExtensions
{
    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub") ?? throw new InvalidOperationException("Jeton sans identifiant."));

    public static bool IsStaff(this ClaimsPrincipal user) => user.IsInRole("Admin") || user.IsInRole("Support");
}
