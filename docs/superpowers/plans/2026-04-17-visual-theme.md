# Epic Medieval Visual Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a cohesive epic medieval visual theme to MetaKing using only Unity built-in URP materials, particles, post-processing, and UI styling — no external assets required.

**Architecture:** A `VisualTheme` Editor script creates all URP Lit materials and stores them in `Assets/Materials/`. `SceneBuilder` is updated to apply these materials and configure lighting, post-processing, and UI colors. All particle systems are configured programmatically.

**Tech Stack:** Unity 6 LTS, URP 17.4.0, TextMeshPro, Unity Particle System, URP Post-processing (Volume)

---

## File Structure

- Create: `client/Assets/Editor/VisualTheme.cs` — creates all URP materials and returns refs
- Modify: `client/Assets/Editor/SceneBuilder.cs` — apply materials, lighting, post-processing, UI colors
- Create: `client/Assets/Materials/` — folder for generated .mat files (auto-created)

---

### Task 1: Create VisualTheme material factory

**Files:**
- Create: `client/Assets/Editor/VisualTheme.cs`

- [ ] **Step 1: Create the file**

```csharp
using UnityEngine;
using UnityEditor;
using System.IO;

/// Creates and caches all URP Lit materials for the epic medieval theme.
public static class VisualTheme
{
    private const string MatDir = "Assets/Materials";

    public static Material Ground    { get; private set; }
    public static Material Player    { get; private set; }
    public static Material Warlock   { get; private set; }
    public static Material Portal    { get; private set; }
    public static Material HeartPickup { get; private set; }
    public static Material WallBoundary { get; private set; }

    [MenuItem("MetaKing/Create Materials")]
    public static void CreateAll()
    {
        Directory.CreateDirectory(Application.dataPath + "/Materials");
        AssetDatabase.Refresh();

        Ground       = Make("Ground",       new Color(0.16f, 0.15f, 0.13f), 0f,   0.3f, Color.black);
        Player       = Make("Player",       new Color(0.78f, 0.59f, 0.16f), 0.7f, 0.6f, new Color(0.78f, 0.59f, 0.16f) * 0.4f);
        Warlock      = Make("Warlock",      new Color(0.55f, 0.10f, 0.10f), 0.3f, 0.4f, new Color(0.8f,  0.05f, 0.05f) * 0.5f);
        Portal       = Make("Portal",       new Color(1.0f,  0.55f, 0.0f),  0f,   0.8f, new Color(1.0f,  0.55f, 0.0f)  * 1.5f);
        HeartPickup  = Make("HeartPickup",  new Color(0.91f, 0.39f, 0.48f), 0f,   0.7f, new Color(0.91f, 0.39f, 0.48f) * 0.8f);
        WallBoundary = Make("WallBoundary", new Color(0.18f, 0.16f, 0.14f), 0.1f, 0.2f, Color.black);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[VisualTheme] All materials created in Assets/Materials/");
    }

    private static Material Make(string name, Color albedo, float metallic, float smoothness, Color emission)
    {
        string path = $"{MatDir}/{name}.mat";
        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
        {
            mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.SetColor("_BaseColor", albedo);
        mat.SetFloat("_Metallic", metallic);
        mat.SetFloat("_Smoothness", smoothness);
        if (emission != Color.black)
        {
            mat.EnableKeyword("_EMISSION");
            mat.SetColor("_EmissionColor", emission);
            mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
        }
        else
        {
            mat.DisableKeyword("_EMISSION");
        }
        EditorUtility.SetDirty(mat);
        return mat;
    }

    /// Load all materials from disk (for use during scene build).
    public static void LoadAll()
    {
        Ground       = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/Ground.mat");
        Player       = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/Player.mat");
        Warlock      = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/Warlock.mat");
        Portal       = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/Portal.mat");
        HeartPickup  = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/HeartPickup.mat");
        WallBoundary = AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/WallBoundary.mat");
    }
}
```

- [ ] **Step 2: Verify it compiles in Unity — no errors in Console**

- [ ] **Step 3: Run MetaKing → Create Materials**

Expected: `[VisualTheme] All materials created in Assets/Materials/` in Console. Six `.mat` files appear in `Assets/Materials/` in the Project window.

- [ ] **Step 4: Commit**

```bash
git add client/Assets/Editor/VisualTheme.cs client/Assets/Materials/
git commit -m "feat: add VisualTheme material factory with epic medieval color palette"
```

---

### Task 2: Apply materials in SceneBuilder — Game scene

**Files:**
- Modify: `client/Assets/Editor/SceneBuilder.cs`

- [ ] **Step 1: Call `VisualTheme.CreateAll()` and apply to GameObjects at top of `BuildGameScene()`**

In `BuildGameScene()`, directly after the scene is created and before the camera, add:

```csharp
VisualTheme.CreateAll();
```

Then after creating the ground plane find the line:
```csharp
var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
ground.name = "Ground";
ground.transform.localScale = new Vector3(10, 1, 10);
```
Add below it:
```csharp
ground.GetComponent<Renderer>().material = VisualTheme.Ground;
```

After the player mesh creation:
```csharp
var playerMesh = GameObject.CreatePrimitive(PrimitiveType.Capsule);
```
Add after `Object.DestroyImmediate(playerMesh.GetComponent<Collider>())`:
```csharp
playerMesh.GetComponent<Renderer>().material = VisualTheme.Player;
```

After the warlock mesh creation:
```csharp
var warlockMesh = GameObject.CreatePrimitive(PrimitiveType.Sphere);
```
Add after `Object.DestroyImmediate(warlockMesh.GetComponent<Collider>())`:
```csharp
warlockMesh.GetComponent<Renderer>().material = VisualTheme.Warlock;
```

After the portal mesh creation:
```csharp
var portalMesh = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
```
Add after `Object.DestroyImmediate(portalMesh.GetComponent<Collider>())`:
```csharp
portalMesh.GetComponent<Renderer>().material = VisualTheme.Portal;
```

After the heart mesh creation:
```csharp
var heartMesh = GameObject.CreatePrimitive(PrimitiveType.Sphere);
```
Add after `Object.DestroyImmediate(heartMesh.GetComponent<Collider>())`:
```csharp
heartMesh.GetComponent<Renderer>().material = VisualTheme.HeartPickup;
```

- [ ] **Step 2: Update directional light color**

Find:
```csharp
dl.intensity = 1f;
```
Change to:
```csharp
dl.color = new Color(1.0f, 0.83f, 0.63f);
dl.intensity = 1.2f;
```

- [ ] **Step 3: Update camera background color**

Find in `BuildGameScene`:
```csharp
cam.backgroundColor = new Color(0.05f, 0.1f, 0.05f);
```
Change to:
```csharp
cam.backgroundColor = new Color(0.06f, 0.04f, 0.02f);
cam.clearFlags = CameraClearFlags.SolidColor;
```

- [ ] **Step 4: Add boundary walls around the map**

After the ground plane block, add:

```csharp
// Boundary walls — dark stone
var wallMat = VisualTheme.WallBoundary;
CreateWall("WallNorth", new Vector3(0, 1, 52),  new Vector3(105, 2, 1), wallMat);
CreateWall("WallSouth", new Vector3(0, 1, -52), new Vector3(105, 2, 1), wallMat);
CreateWall("WallEast",  new Vector3(52, 1, 0),  new Vector3(1, 2, 105), wallMat);
CreateWall("WallWest",  new Vector3(-52, 1, 0), new Vector3(1, 2, 105), wallMat);
```

And add the helper method to the `SceneBuilder` class (outside `BuildGameScene`):

```csharp
static void CreateWall(string name, Vector3 pos, Vector3 scale, Material mat)
{
    var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
    wall.name = name;
    wall.transform.position = pos;
    wall.transform.localScale = scale;
    wall.GetComponent<Renderer>().material = mat;
}
```

- [ ] **Step 5: Run MetaKing → Build All Scenes, hit Play**

Expected: Game scene has gold player, crimson warlocks, amber portals, warm lighting, dark stone ground.

- [ ] **Step 6: Commit**

```bash
git add client/Assets/Editor/SceneBuilder.cs
git commit -m "feat: apply medieval materials and warm lighting to Game scene"
```

---

### Task 3: Add post-processing (URP Global Volume)

**Files:**
- Modify: `client/Assets/Editor/SceneBuilder.cs`

- [ ] **Step 1: Add using directives at top of SceneBuilder.cs**

Add after existing usings:
```csharp
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
```

- [ ] **Step 2: Add post-processing volume to Game scene**

In `BuildGameScene()`, before the EventSystem block, add:

```csharp
// Post-processing global volume
var volumeGo = new GameObject("PostProcessVolume");
var volume = volumeGo.AddComponent<Volume>();
volume.isGlobal = true;
volume.priority = 1;
var profile = ScriptableObject.CreateInstance<VolumeProfile>();

// Bloom
var bloom = profile.Add<Bloom>(true);
bloom.threshold.value = 0.8f;
bloom.intensity.value = 1.2f;
bloom.scatter.value = 0.5f;
bloom.tint.value = new Color(1.0f, 0.85f, 0.6f);

// Vignette
var vignette = profile.Add<Vignette>(true);
vignette.intensity.value = 0.35f;
vignette.smoothness.value = 0.4f;
vignette.color.value = new Color(0.1f, 0.05f, 0.0f);

// Color Adjustments
var colorAdj = profile.Add<ColorAdjustments>(true);
colorAdj.postExposure.value = 0.1f;
colorAdj.contrast.value = 15f;
colorAdj.colorFilter.value = new Color(1.0f, 0.95f, 0.85f);
colorAdj.saturation.value = 10f;

// Shadows Midtones Highlights
var smh = profile.Add<ShadowsMidtonesHighlights>(true);
smh.shadows.value = new Vector4(0.9f, 0.8f, 0.7f, 0f);
smh.highlights.value = new Vector4(1.05f, 1.0f, 0.9f, 0f);

volume.sharedProfile = profile;

// Save the profile asset
string profilePath = "Assets/Materials/PostProcessProfile.asset";
AssetDatabase.CreateAsset(profile, profilePath);
```

- [ ] **Step 3: Enable post-processing on the camera**

Find the camera setup in `BuildGameScene`:
```csharp
cam.clearFlags = CameraClearFlags.SolidColor;
```
Add after it:
```csharp
var cameraData = camGo.AddComponent<UnityEngine.Rendering.Universal.UniversalAdditionalCameraData>();
cameraData.renderPostProcessing = true;
```

- [ ] **Step 4: Run MetaKing → Build All Scenes, hit Play**

Expected: Warm bloom glow on emissive objects (player, warlocks, portals), dark vignette edges, golden color tint.

- [ ] **Step 5: Commit**

```bash
git add client/Assets/Editor/SceneBuilder.cs client/Assets/Materials/PostProcessProfile.asset
git commit -m "feat: add URP post-processing — bloom, vignette, warm color grading"
```

---

### Task 4: Style the UI — dark parchment medieval theme

**Files:**
- Modify: `client/Assets/Editor/SceneBuilder.cs`

- [ ] **Step 1: Update MakeCanvas background color**

In `SceneBuilder`, update `MakeCanvas` to add a background Image:

```csharp
static GameObject MakeCanvas(string name)
{
    var go     = new GameObject(name);
    var canvas = go.AddComponent<Canvas>();
    canvas.renderMode = RenderMode.ScreenSpaceOverlay;
    var scaler = go.AddComponent<CanvasScaler>();
    scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
    scaler.referenceResolution = new Vector2(1170, 2532); // iPhone 14 Pro
    scaler.matchWidthOrHeight = 0.5f;
    go.AddComponent<GraphicRaycaster>();
    return go;
}
```

- [ ] **Step 2: Update MakeButton to use medieval styling**

Replace the existing `MakeButton` helper:

```csharp
static Button MakeButton(Transform parent, string name, string label)
{
    var go = new GameObject(name);
    go.transform.SetParent(parent, false);
    var rt = go.AddComponent<RectTransform>();
    rt.sizeDelta = new Vector2(280, 60);
    var img = go.AddComponent<Image>();
    img.color = new Color(0.24f, 0.20f, 0.17f); // dark stone
    var btn = go.AddComponent<Button>();

    // Gold border via outline child
    var border = new GameObject("Border");
    border.transform.SetParent(go.transform, false);
    var borderRt = border.AddComponent<RectTransform>();
    borderRt.anchorMin = Vector2.zero;
    borderRt.anchorMax = Vector2.one;
    borderRt.offsetMin = new Vector2(-2, -2);
    borderRt.offsetMax = new Vector2(2, 2);
    var borderImg = border.AddComponent<Image>();
    borderImg.color = new Color(0.78f, 0.59f, 0.16f); // gold
    border.transform.SetAsFirstSibling();

    var textGo = new GameObject("Label");
    textGo.transform.SetParent(go.transform, false);
    var textRt = textGo.AddComponent<RectTransform>();
    textRt.anchorMin = Vector2.zero;
    textRt.anchorMax = Vector2.one;
    textRt.offsetMin = Vector2.zero;
    textRt.offsetMax = Vector2.zero;
    var tmp = textGo.AddComponent<TextMeshProUGUI>();
    tmp.text = label;
    tmp.alignment = TextAlignmentOptions.Center;
    tmp.color = new Color(0.78f, 0.59f, 0.16f); // gold text
    tmp.fontSize = 24;
    tmp.fontStyle = FontStyles.Bold;

    // Button color tint on hover/press
    var colors = btn.colors;
    colors.normalColor = Color.white;
    colors.highlightedColor = new Color(1.3f, 1.1f, 0.8f);
    colors.pressedColor = new Color(0.7f, 0.5f, 0.2f);
    btn.colors = colors;
    btn.targetGraphic = img;

    return btn;
}
```

- [ ] **Step 3: Update MakeText to use gold color**

Replace the existing `MakeText` helper:

```csharp
static TMP_Text MakeText(Transform parent, string name, string text)
{
    var go = new GameObject(name);
    go.transform.SetParent(parent, false);
    go.AddComponent<RectTransform>();
    var tmp = go.AddComponent<TextMeshProUGUI>();
    tmp.text = text;
    tmp.fontSize = 24;
    tmp.color = new Color(0.85f, 0.72f, 0.45f); // warm parchment gold
    return tmp;
}
```

- [ ] **Step 4: Add dark parchment background to Bootstrap canvas**

In `BuildBootstrapScene()`, after `MakeCanvas`:

```csharp
// Dark parchment background
var bgGo = new GameObject("Background");
bgGo.transform.SetParent(canvas.transform, false);
var bgRt = bgGo.AddComponent<RectTransform>();
bgRt.anchorMin = Vector2.zero;
bgRt.anchorMax = Vector2.one;
bgRt.offsetMin = Vector2.zero;
bgRt.offsetMax = Vector2.zero;
bgGo.AddComponent<Image>().color = new Color(0.10f, 0.08f, 0.06f);
bgGo.transform.SetAsFirstSibling();
```

- [ ] **Step 5: Run MetaKing → Build All Scenes, hit Play**

Expected: Bootstrap scene shows dark parchment background, gold text, stone buttons with gold borders and gold labels.

- [ ] **Step 6: Commit**

```bash
git add client/Assets/Editor/SceneBuilder.cs
git commit -m "feat: apply medieval UI theme — dark parchment, gold text, stone buttons"
```

---

### Task 5: Configure particle systems with medieval theme

**Files:**
- Modify: `client/Assets/Editor/SceneBuilder.cs`

Portal idle particles should emit amber sparks. Portal enter particles emit a golden burst. Hit particles emit red sparks.

- [ ] **Step 1: Add `ConfigurePortalParticles` helper to SceneBuilder**

Add this static method to `SceneBuilder`:

```csharp
static void ConfigureIdleParticles(ParticleSystem ps, Color color)
{
    var main = ps.main;
    main.loop = true;
    main.startLifetime = 1.5f;
    main.startSpeed = 1.5f;
    main.startSize = 0.08f;
    main.startColor = color;
    main.gravityModifier = -0.3f; // sparks rise
    main.maxParticles = 40;

    var emission = ps.emission;
    emission.rateOverTime = 15f;

    var shape = ps.shape;
    shape.shapeType = ParticleSystemShapeType.Disc;
    shape.radius = 0.8f;

    var colorOverLifetime = ps.colorOverLifetime;
    colorOverLifetime.enabled = true;
    var grad = new Gradient();
    grad.SetKeys(
        new GradientColorKey[] { new GradientColorKey(color, 0f), new GradientColorKey(color, 1f) },
        new GradientAlphaKey[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0f, 1f) }
    );
    colorOverLifetime.color = grad;
}

static void ConfigureBurstParticles(ParticleSystem ps, Color color)
{
    var main = ps.main;
    main.loop = false;
    main.startLifetime = 0.8f;
    main.startSpeed = 4f;
    main.startSize = 0.12f;
    main.startColor = color;
    main.maxParticles = 60;

    var emission = ps.emission;
    emission.SetBursts(new ParticleSystem.Burst[] {
        new ParticleSystem.Burst(0f, 60)
    });
    emission.rateOverTime = 0f;

    var shape = ps.shape;
    shape.shapeType = ParticleSystemShapeType.Sphere;
    shape.radius = 0.3f;
}
```

- [ ] **Step 2: Apply particle configs in portal prefab creation**

Find the portal prefab section:
```csharp
var portalComp = portalPrefabGo.AddComponent<Portal>();
```

Before that line, add:
```csharp
var idlePs  = new GameObject("IdleParticles").AddComponent<ParticleSystem>();
idlePs.transform.SetParent(portalPrefabGo.transform);
idlePs.transform.localPosition = Vector3.zero;
ConfigureIdleParticles(idlePs, new Color(1.0f, 0.55f, 0.0f));

var enterPs = new GameObject("EnterParticles").AddComponent<ParticleSystem>();
enterPs.transform.SetParent(portalPrefabGo.transform);
enterPs.transform.localPosition = Vector3.zero;
ConfigureBurstParticles(enterPs, new Color(1.0f, 0.85f, 0.3f));
```

Then after `AddComponent<Portal>()`:
```csharp
SetPrivate(portalComp, "idleParticles",  idlePs);
SetPrivate(portalComp, "enterParticles", enterPs);
```

- [ ] **Step 3: Apply particle config to heart pickup**

Find heart pickup prefab creation. After `heartGo.AddComponent<HeartPickup>()`:
```csharp
var heartPs = new GameObject("SparkleParticles").AddComponent<ParticleSystem>();
heartPs.transform.SetParent(heartGo.transform);
heartPs.transform.localPosition = Vector3.zero;
ConfigureIdleParticles(heartPs, new Color(0.91f, 0.39f, 0.48f));
```

- [ ] **Step 4: Apply hit particle config to player combat prefab**

Find player section. After `var combat = playerGo.AddComponent<PlayerCombat>()`:
```csharp
var hitPsGo = new GameObject("HitParticles");
hitPsGo.transform.SetParent(playerGo.transform);
hitPsGo.transform.localPosition = Vector3.zero;
var hitPs = hitPsGo.AddComponent<ParticleSystem>();
ConfigureBurstParticles(hitPs, new Color(0.9f, 0.1f, 0.1f));
SetPrivate(combat, "hitParticles", hitPs);
```

- [ ] **Step 5: Run MetaKing → Build All Scenes, hit Play**

Expected: Amber sparks rise from portal locations. Pink sparkles bob around heart pickup. No errors in Console.

- [ ] **Step 6: Commit**

```bash
git add client/Assets/Editor/SceneBuilder.cs
git commit -m "feat: add medieval particle effects — amber portal sparks, pink heart sparkles, red hit burst"
```

---

### Task 6: Final polish — ambient light and ground tiling

**Files:**
- Modify: `client/Assets/Editor/SceneBuilder.cs`

- [ ] **Step 1: Set ambient lighting in Game scene**

In `BuildGameScene()`, after the directional light setup, add:

```csharp
// Warm ambient light
RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
RenderSettings.ambientLight = new Color(0.16f, 0.10f, 0.04f);
RenderSettings.fogColor = new Color(0.10f, 0.07f, 0.04f);
RenderSettings.fog = true;
RenderSettings.fogMode = FogMode.Linear;
RenderSettings.fogStartDistance = 30f;
RenderSettings.fogEndDistance = 80f;
```

- [ ] **Step 2: Set ambient lighting in Bootstrap scene**

In `BuildBootstrapScene()`, before saving:

```csharp
RenderSettings.ambientLight = new Color(0.10f, 0.08f, 0.06f);
```

- [ ] **Step 3: Run MetaKing → Build All Scenes, hit Play**

Expected: Game scene has warm dark ambient, distant fog fades objects to dark brown at edges of map. Bootstrap has dark warm ambient. Overall the game looks cohesive and atmospheric.

- [ ] **Step 4: Commit and push**

```bash
git add client/Assets/Editor/SceneBuilder.cs client/Assets/Materials/
git commit -m "feat: add warm ambient lighting and distance fog for atmospheric depth"
git push
```
