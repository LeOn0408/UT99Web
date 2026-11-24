namespace UT99Web.Server.Unreal;

public sealed record UnrealClassInfo(string Name, string? SuperName, List<string> Children);

public sealed partial class UnrealScriptService
{
    private readonly string? packagePath;
    private readonly object gate = new();
    private UnrealPackage? package;
    private Dictionary<string, UnrealClassInfo>? classes;

    public UnrealScriptService(string packagePath)
    {
        this.packagePath = File.Exists(packagePath) ? packagePath : null;
    }

    public bool Available => packagePath is not null;

    public IReadOnlyDictionary<string, UnrealClassInfo> Classes
    {
        get
        {
            EnsureLoaded();
            return classes ?? new Dictionary<string, UnrealClassInfo>();
        }
    }

    public UnrealClassInfo? FindClass(string name)
    {
        EnsureLoaded();
        return classes?.GetValueOrDefault(name);
    }

    public IReadOnlyList<string> Ancestry(string name)
    {
        var result = new List<string>();
        var current = FindClass(name);
        while (current is not null && result.Count < 128)
        {
            result.Add(current.Name);
            current = current.SuperName is null ? null : FindClass(current.SuperName);
        }
        return result;
    }

    private void EnsureLoaded()
    {
        if (classes is not null || packagePath is null) return;
        lock (gate)
        {
            if (classes is not null || packagePath is null) return;
            package = UnrealPackage.Load(packagePath);
            var table = new Dictionary<string, UnrealClassInfo>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in package.Exports.Where(item => item.ClassIndex == 0 && item.ObjectName is not null))
            {
                table[item.ObjectName!] = new UnrealClassInfo(
                    item.ObjectName!,
                    package.ResolveObjectName(item.SuperIndex),
                    new List<string>());
            }

            foreach (var info in table.Values)
            {
                if (info.SuperName is null) continue;
                if (table.TryGetValue(info.SuperName, out var parent)) parent.Children.Add(info.Name);
            }

            classes = table;
        }
    }
}
