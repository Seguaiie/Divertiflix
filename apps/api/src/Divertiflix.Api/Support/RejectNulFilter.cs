using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Divertiflix.Api.Support;

/// <summary>
/// PostgreSQL refuse U+0000 dans un texte (erreur 22021) : sans ce filtre, un seul caractère nul dans un champ ou un paramètre
/// donne un 500. On le refuse à l'entrée, partout, avec un 400. Parcourt les arguments d'action (textes, DTO de ce projet, listes).
/// </summary>
public sealed class RejectNulFilter : IActionFilter
{
    private const int MaxDepth = 6;
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> Props = new();

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ActionArguments.Values.Any(v => HasNul(v, 0))) return;
        const string message = "Le texte contient un caractère nul (U+0000), interdit.";
        context.Result = context.Controller is ControllerBase c ? c.Err(400, message) : new BadRequestResult();
    }

    public void OnActionExecuted(ActionExecutedContext context) { }

    private static bool HasNul(object? value, int depth)
    {
        if (value is null) return false;
        if (value is string s) return s.Contains('\0');
        if (depth >= MaxDepth) return false;
        if (value is IEnumerable items) return items.Cast<object?>().Any(i => HasNul(i, depth + 1));
        var type = value.GetType();
        if (type.Namespace?.StartsWith("Divertiflix", StringComparison.Ordinal) != true) return false;   // nombres, identifiants, dates : rien à chercher
        var props = Props.GetOrAdd(type, t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanRead && p.GetIndexParameters().Length == 0).ToArray());
        return props.Any(p => HasNul(p.GetValue(value), depth + 1));
    }
}
