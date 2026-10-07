using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Infrastructure;

public static class DependencyInjection
{
    /// <summary>PostgreSQL (docker-compose en dev, conteneur en prod).</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var cs = config.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings:Default manquante.");
        services.AddDbContext<DivertiflixDbContext>(o => o.UseNpgsql(cs));
        return services;
    }
}
