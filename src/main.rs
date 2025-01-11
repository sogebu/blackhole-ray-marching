use blackhole_ray_marching::*;
use rand::Rng;
use rayon::prelude::*;
use std::io::{stdout, Write};

const BH_M: f64 = 1.0;
const BH_POS: Vector = vec3!(0.0, 0.0, 0.0);
const BH: Sphere = Sphere::new(BH_POS, BH_M * 1.5);

fn ray_color(objects: &[Object], ray: &Ray) -> Color {
    const D_TAU: f64 = 1.0 / 16.0; // 固有時間のステップサイズ

    let mut x = ray.origin;
    let mut v = ray.direction.normalized();

    let mut min_dist = BH.signed_distance(x);
    for object in objects {
        let dist = object.sphere.signed_distance(x);
        if dist < min_dist {
            min_dist = dist;
        }
    }
    // 予想外
    if min_dist < 0.0 {
        return vec3!(0.0, 0.0, 0.0);
    }

    let mut rest_dist = min_dist * 0.9;
    for _ in 0..10_000 {
        let dx = x - BH_POS;
        let r = dx.norm();

        // ブラックホールに吸い込まれる場合は黒色
        if r < 1.5 * BH_M {
            return vec3!(0.0, 0.0, 0.0);
        }

        // Compute accelerations in Cartesian coordinates
        let a = dx * (-BH_M / r.powi(3) + (2.0 * BH_M / r.powi(3)) * v.dot(&dx) / r.powi(2));

        // update
        v += a * D_TAU;
        x += v * D_TAU;
        rest_dist -= v.norm() * D_TAU;

        if rest_dist <= 0.0 {
            min_dist = BH.signed_distance(x);
            for object in objects {
                let dist = object.sphere.signed_distance(x);
                if dist <= 0.0 {
                    let l = x - object.sphere.center;
                    let n = 8.0;
                    let theta = ((l.z() / l.norm()).acos() * 2.0 / std::f64::consts::PI * n) as i32;
                    let phi = ((l.x().atan2(l.y()) * n).floor() / std::f64::consts::PI * n) as i32;
                    return if (theta + phi) % 2 == 0 {
                        object.color
                    } else {
                        object.color * 0.5
                    };
                }
                if dist < min_dist {
                    min_dist = dist;
                }
            }
            rest_dist = min_dist * 0.9;
        }
    }
    vec3!(0.0, 0.0, 1.0)
}

#[derive(Debug, Clone)]
pub struct Object {
    sphere: Sphere,
    color: Color,
}

fn make_scene<R: Rng>(rng: &mut R) -> Vec<Object> {
    let mut objects = Vec::<Object>::new();
    objects.push(Object {
        sphere: Sphere::new(vec3!(2.0, 3.0, 0.0), 1.0),
        color: Vector::random_in_unit_sphere(rng) * 0.4 + 0.6,
    });
    objects.push(Object {
        sphere: Sphere::new(vec3!(-1.0, -1.0, 3.0), 1.0),
        color: Vector::random_in_unit_sphere(rng) * 0.4 + 0.6,
    });
    objects.push(Object {
        sphere: Sphere::new(vec3!(2.0, -3.0, -1.0), 1.0),
        color: Vector::random_in_unit_sphere(rng) * 0.4 + 0.6,
    });
    'OUT: for _ in 0..10 {
        let center = Vector::random_in_unit_sphere(rng) * 7.0;
        if center.z() < -10.0 {
            continue;
        }
        let radius = rng.random_range(0.0..1.0) * 3.0;
        if (center - BH_POS).norm() < 2.0 * BH_M + radius {
            continue;
        }
        for object in objects.iter() {
            if (object.sphere.center - center).norm() < object.sphere.radius + radius {
                continue 'OUT;
            }
        }
        objects.push(Object {
            sphere: Sphere::new(center, radius),
            color: Vector::random_in_unit_sphere(rng) * 0.4 + 0.6,
        });
    }
    objects
}

fn main() {
    let stdout = stdout();
    let mut cout = stdout.lock();
    let mut rng = rand_pcg::Mcg128Xsl64::new(32);

    // camera
    let camera = CameraBuilder::new()
        .look_from(vec3!(0.0, 0.0, -15.0))
        .loot_at(vec3!(0.0))
        .vertical_field_of_view(60.0)
        .aspect_ratio(3.0 / 2.0)
        .pin_hole();

    // image
    let width = 600_u32;
    let height = (width as f64 / camera.aspect_ratio()).floor() as u32;

    // objects
    let world = make_scene(&mut rng);
    eprintln!("make world done");

    // render
    let mut pixels = Vec::with_capacity(width as usize * height as usize);
    for y in (0..height).rev() {
        for x in 0..width {
            pixels.push((y, x));
        }
    }
    let colors = pixels
        .par_iter()
        .map(|&(y, x)| {
            let u = x as f64 / (width as f64 - 1.0);
            let v = y as f64 / (height as f64 - 1.0);
            let ray = camera.get_ray(u, v);
            ray_color(&world, &ray)
        })
        .collect::<Vec<_>>();

    // save as ppm
    writeln!(cout, "P3").unwrap();
    writeln!(cout, "{} {}", width, height).unwrap();
    writeln!(cout, "255").unwrap();
    for color in colors {
        write_color(&mut cout, color).unwrap()
    }
}
