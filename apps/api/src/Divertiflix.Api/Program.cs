using System.Text;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Data;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Realtime;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (jwt.Key.Length < 32) throw new InvalidOperationException("Jwt:Key doit contenir au moins 32 caractères (variable d'environnement Jwt__Key).");
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.AddSingleton<TokenService>();

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
// Le générateur OpenAPI lit les options HTTP (pas celles de MVC) : sans ceci, les enums sont décrits comme des entiers.
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddSignalR();

// Pont MQTT -> SignalR (étape 4) : capteurs ESP32 publiés sur Mosquitto (docker-compose).
// Démarré en arrière-plan, se reconnecte seul ; n'empêche jamais l'API de démarrer si Mosquitto est down.
builder.Services.AddHostedService<MqttBridgeService>();

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
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

// React (5173) et Angular (4200) en dev ; à restreindre via Cors:Origins en prod.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173", "http://localhost:4200"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    await Seeder.SeedAsync(scope.ServiceProvider, app.Configuration);

if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<NotificationsHub>("/hubs/notifications");
app.Run();

public partial class Program; // visibilité pour les tests d'intégration
