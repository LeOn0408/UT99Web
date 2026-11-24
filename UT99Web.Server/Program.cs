using Microsoft.Extensions.FileProviders;
using UT99Web.Server.Game;
using UT99Web.Server.Unreal;

var builder = WebApplication.CreateBuilder(args);
if (string.IsNullOrWhiteSpace(builder.Configuration["urls"]))
{
    builder.WebHost.UseUrls("http://localhost:8123");
}

var app = builder.Build();

var repoRoot = FindRepoRoot(
    app.Environment.ContentRootPath,
    AppContext.BaseDirectory,
    Directory.GetCurrentDirectory());
var frontendRoot = Path.Combine(repoRoot, "UT99Web.Frontend");
var webRoot = Path.Combine(frontendRoot, "web");
var assetsRoot = Path.Combine(frontendRoot, "assets");
var scripts = new UnrealScriptService(Path.Combine(assetsRoot, "game", "System", "BotPack.u"));
var games = new GameSessionService();

app.Use(async (context, next) =>
{
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["Cross-Origin-Opener-Policy"] = "same-origin";
    context.Response.Headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    await next();
});

foreach (var name in new[] { "web", "engine", "tools", "assets", "localization" })
{
    var directory = Path.Combine(frontendRoot, name);
    if (!Directory.Exists(directory))
    {
        continue;
    }

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(directory),
        RequestPath = "/" + name,
        ServeUnknownFileTypes = true,
        DefaultContentType = "application/octet-stream"
    });
}

app.MapGet("/", () => Results.Redirect("/web/viewer.html"));

app.MapGet("/api/health", () => Results.Ok(new
{
    ok = true,
    service = "ut99web",
    utc = DateTimeOffset.UtcNow,
    web = Directory.Exists(webRoot),
    assets = Directory.Exists(assetsRoot)
}));

app.MapGet("/api/maps", () =>
{
    var mapsRoot = Path.Combine(assetsRoot, "game", "Maps");
    if (!Directory.Exists(mapsRoot))
    {
        return Results.Ok(new { maps = Array.Empty<object>() });
    }

    var maps = Directory.EnumerateFiles(mapsRoot, "*.unr.uz")
        .Select(file =>
        {
            var name = Path.GetFileName(file);
            var id = name.EndsWith(".unr.uz", StringComparison.OrdinalIgnoreCase)
                ? name[..^7]
                : Path.GetFileNameWithoutExtension(name);
            return new
            {
                id,
                file = name,
                url = $"/assets/game/Maps/{Uri.EscapeDataString(name)}",
                size = new FileInfo(file).Length
            };
        })
        .OrderBy(map => map.id, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    return Results.Ok(new { maps });
});

app.MapGet("/api/assets", () =>
{
    var gameRoot = Path.Combine(assetsRoot, "game");
    if (!Directory.Exists(gameRoot))
    {
        return Results.Ok(new { groups = Array.Empty<object>() });
    }

    var groups = new[] { "Maps", "Textures", "System", "Sounds", "Music", "Scripts" }
        .Select(name =>
        {
            var directory = Path.Combine(gameRoot, name);
            if (!Directory.Exists(directory))
            {
                return new { name, files = 0, bytes = 0L };
            }

            var files = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).ToArray();
            var bytes = files.Sum(file => new FileInfo(file).Length);
            return new { name, files = files.Length, bytes };
        })
        .ToArray();

    return Results.Ok(new { groups });
});

app.MapGet("/api/uscript/classes", (string? filter) =>
{
    var items = scripts.Classes.Values
        .Where(item => string.IsNullOrWhiteSpace(filter) || item.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))
        .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
        .Select(item => new { item.Name, item.SuperName, children = item.Children.Count })
        .ToArray();
    return Results.Ok(new { available = scripts.Available, count = items.Length, classes = items });
});

app.MapGet("/api/uscript/class/{name}", (string name) =>
{
    var info = scripts.FindClass(name);
    if (info is null) return Results.NotFound(new { error = "class_not_found", name });
    return Results.Ok(new
    {
        info.Name,
        info.SuperName,
        ancestry = scripts.Ancestry(info.Name),
        children = info.Children.OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
    });
});

app.MapPost("/api/game/session", (CreateSessionRequest? request) =>
{
    var session = games.Create(Math.Clamp(request?.BotCount ?? 4, 0, 16));
    return Results.Ok(Snapshot(session));
});

app.MapGet("/api/game/session/{id}", (string id) =>
{
    var session = games.Get(id);
    return session is null ? Results.NotFound(new { error = "session_not_found" }) : Results.Ok(Snapshot(session));
});

app.MapPost("/api/game/session/{id}/damage", (string id, DamageRequest request) =>
{
    var result = games.Damage(id, request.Target, request.Amount, request.Source ?? "unknown");
    return result is null ? Results.NotFound(new { error = "session_or_target_not_found" }) : Results.Ok(result);
});

app.MapPost("/api/game/session/{id}/weapon-hit", (string id, WeaponHitRequest request) =>
{
    var result = games.WeaponHit(id, request.Weapon, request.Target);
    return result is null ? Results.NotFound(new { error = "weapon_or_target_not_found" }) : Results.Ok(result);
});

app.MapPost("/api/game/session/{id}/bot-hit", (string id, BotHitRequest request) =>
{
    var result = games.BotHit(id, request.Bot);
    return result is null ? Results.NotFound(new { error = "bot_not_found" }) : Results.Ok(result);
});

app.MapPost("/api/game/session/{id}/respawn", (string id, string? target) =>
{
    var session = target is null ? games.Respawn(id) : games.RespawnBot(id, target);
    return session is null ? Results.NotFound(new { error = "session_or_target_not_found" }) : Results.Ok(Snapshot(session));
});

app.MapFallback(context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        return Results.NotFound(new { error = "not_found" }).ExecuteAsync(context);
    }

    context.Response.StatusCode = StatusCodes.Status404NotFound;
    return context.Response.WriteAsync("Not found");
});

app.Run();

static object Snapshot(GameSession session) => new
{
    id = session.Id,
    health = session.Health,
    armor = session.Armor,
    frags = session.Frags,
    deaths = session.Deaths,
    dead = session.Dead,
    bots = session.Bots
};

static string FindRepoRoot(params string[] starts)
{
    foreach (var start in starts)
    {
        if (string.IsNullOrWhiteSpace(start))
        {
            continue;
        }

        var directory = new DirectoryInfo(start);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "UT99Web.Frontend", "web", "viewer.html")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }
    }

    return Path.GetFullPath(starts.FirstOrDefault() ?? ".");
}
