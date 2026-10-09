using System.Text;
using System.Threading.RateLimiting;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Data;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Media;
using Divertiflix.Api.Realtime;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (jwt.Key.Length < 32) throw new InvalidOperationException("Jwt:Key doit contenir au moins 32 caractères (variable d'environnement Jwt__Key).");
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<StreamSigner>();

// En production : journaux JSON (une ligne par évènement, avec RequestId) pour la centralisation des journaux.
if (!builder.Environment.IsDevelopment() && !builder.Environment.IsEnvironment("Testing")) builder.Logging.AddJsonConsole();

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
// Le générateur OpenAPI lit les options HTTP (pas celles de MVC) : sans ceci, les enums sont décrits comme des entiers.
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();
builder.Services.AddSignalR();

builder.Services.AddSingleton<CatalogCache>();
builder.Services.AddSingleton<MqttStatus>();
builder.Services.AddScoped<HomeService>();
builder.Services.AddScoped<AssistantService>();
builder.Services.AddScoped<Notifier>();
builder.Services.AddScoped<Audit>();

// Pont MQTT -> SignalR (capteurs ESP32 publiés sur Mosquitto). Se reconnecte seul, ne bloque jamais le démarrage.
builder.Services.AddHostedService<MqttBridgeService>();
builder.Services.AddHostedService<RetentionService>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ClockSkew = TimeSpan.FromSeconds(30),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
        };
        // SignalR sur WebSocket ne peut pas poser d'en-tête Authorization : le jeton voyage dans la query string.
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/api/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

// Limitation de débit : par adresse IP pour l'authentification et les synchronisations, par utilisateur pour le reste.
// Les plafonds se règlent par configuration (RateLimit:*), les tests les relèvent.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/problem+json";
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry)) ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
        await ctx.HttpContext.Response.WriteAsJsonAsync(new { type = "about:blank", title = "Too Many Requests", status = 429, detail = "Trop de requêtes, réessayez dans un instant.", error = "Trop de requêtes, réessayez dans un instant." }, ct);
    };
    int Limit(string key, int fallback) => builder.Configuration.GetValue<int?>($"RateLimit:{key}") ?? fallback;
    static string Ip(HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    static string Who(HttpContext c) => c.User.Identity?.IsAuthenticated == true ? c.User.UserId().ToString() : Ip(c);
    o.AddPolicy("auth", c => RateLimitPartition.GetFixedWindowLimiter("auth:" + Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit("AuthPerMinute", 20), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("sync", c => RateLimitPartition.GetFixedWindowLimiter("sync:" + Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit("SyncPerMinute", 30), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("write", c => RateLimitPartition.GetFixedWindowLimiter("write:" + Who(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit("WritePerMinute", 30), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("assistant", c => RateLimitPartition.GetFixedWindowLimiter("assistant:" + Who(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit("AssistantPerMinute", 40), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("media", c => RateLimitPartition.GetFixedWindowLimiter("media:" + Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit("MediaPerMinute", 3000), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// nginx est local : on fait confiance à X-Forwarded-* de la boucle locale seulement (adresse IP réelle pour la limitation).
builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

// React (5173) et Angular (4200) en dev ; à restreindre via Cors:Origins en prod. Pas de cookies : pas de credentials.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173", "http://localhost:4200"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    await Seeder.SeedAsync(scope.ServiceProvider, app.Configuration);

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler();
app.UseStatusCodePages();

// En-têtes de sécurité de l'API (nginx ajoute CSP et HSTS pour les pages).
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["Referrer-Policy"] = "no-referrer";
    h["X-Frame-Options"] = "DENY";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    await next();
});

if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.UseCors();
MediaEndpoints.Map(app);
app.UseAuthentication();
app.UseRateLimiter();   // après l'authentification : les plafonds « write » et « assistant » sont par utilisateur
app.UseAuthorization();
app.MapControllers();
app.MapHub<NotificationsHub>("/api/hubs/notifications", o => o.CloseOnAuthenticationExpiration = true);
app.Run();

public partial class Program; // visibilité pour les tests d'intégration
